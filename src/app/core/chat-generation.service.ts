/**
 * Chat generation service.
 *
 * Orchestrates chat turns: appends the user message (when present), creates an
 * assistant placeholder, streams the response from POST /v1/chat/completions
 * (the OpenAI-compatible endpoint — never /api/v0), updates the in-memory
 * message as events arrive and finalizes status + benchmark metrics.
 *
 * Phase 8 operations:
 *  - regenerateLatest(): drops the latest assistant response and resends the
 *    full history.
 *  - editAndRegenerate(): edits a user message, discards every dependent later
 *    response (store truncation) and resends the revised history.
 *
 * Cancellation: the stop button aborts the AbortController; partial content is
 * preserved and the message is marked 'cancelled'. Malformed or interrupted
 * streams keep whatever content arrived (recovery) and are marked accordingly.
 */

import { Injectable, Signal, signal } from '@angular/core';
import { LmStudioClient } from './lm-studio-client.service';
import { toLmApiError } from './api-error';
import { ConnectionStore } from './connection.store';
import { ConversationStore } from './conversation.store';
import { ModelLifecycleStore } from './model-lifecycle.store';
import { ChatSessionStore } from './chat-session.store';
import { SettingsStore } from './settings.store';
import type { ChatMessage, ResponseMetrics, StreamEvent, UsageStats } from './types/lm-studio.types';

export interface SendGuard {
  ok: boolean;
  reason?: string;
}

/** Mutable per-turn stream state (local to one runTurn() call). */
interface TurnState {
  content: string;
  reasoning: string;
  usage: UsageStats | undefined;
  firstContentAtMs: number | undefined;
}

/** Phase text shown once a stream has been silent past the warning threshold. */
const WAITING_PHASE_PREFIX = 'Waiting for the model';

@Injectable({ providedIn: 'root' })
export class ChatGenerationService {
  /**
   * Stream-liveness watchdog thresholds (overridable in tests):
   *  - silentWarnMs:   after this much silence the UI shows a "waiting" notice.
   *  - silentTimeoutMs: a stream silent for this long is failed instead of
   *    hanging forever. LM Studio serves a single generation slot — a request
   *    queued behind another generation delivers NO data until the slot frees,
   *    so without this guard a turn would block every later send indefinitely.
   */
  static silentWarnMs = 30_000;
  static silentTimeoutMs = 120_000;

  private readonly client = new LmStudioClient();

  /** Transient stream phase shown in the UI (model loading / prompt processing). */
  readonly phase = signal<string | null>(null);

  /** Reactive "generation in flight" flag for templates. */
  readonly isActive: Signal<boolean>;

  constructor(
    private readonly conversations: ConversationStore,
    private readonly connections: ConnectionStore,
    private readonly lifecycle: ModelLifecycleStore,
    private readonly session: ChatSessionStore,
    private readonly settings: SettingsStore
  ) {
    // Assigned in the body (not a field initializer) because parameter
    // properties are only available once construction has started.
    this.isActive = this.session.isGenerating;
  }

  /** Sending is allowed only with a loaded model and no in-flight request. */
  canSend(): SendGuard {
    if (this.session.active) return { ok: false, reason: 'A response is already being generated.' };
    const modelId = this.connections.loadedModelId;
    if (!modelId) return { ok: false, reason: 'No model loaded. Load a model from the right panel first.' };
    return { ok: true };
  }

  /** Cancel the in-flight generation (stop button). */
  cancel(): void {
    this.session.cancel();
  }

  /** Send a new user message and generate a response. */
  async send(conversationId: string, text: string): Promise<ChatMessage | null> {
    const trimmed = text.trim();
    if (!trimmed) return null;
    const guard = this.canSend();
    if (!guard.ok) return null;

    this.conversations.addMessage(conversationId, { role: 'user', content: trimmed, status: 'completed' });
    return this.runTurn(conversationId);
  }

  /** Regenerate the latest assistant response (drops it and resends history). */
  async regenerateLatest(conversationId: string): Promise<ChatMessage | null> {
    const guard = this.canSend();
    if (!guard.ok) return null;
    if (!this.conversations.removeLatestAssistantMessage(conversationId)) return null;
    return this.runTurn(conversationId);
  }

  /** Edit a user message, discard dependent later responses and resend. */
  async editAndRegenerate(conversationId: string, messageId: string, newContent: string): Promise<ChatMessage | null> {
    const guard = this.canSend();
    if (!guard.ok) return null;
    const removed = this.conversations.editUserMessage(conversationId, messageId, newContent.trim());
    if (removed === 0 && !this.conversations.findMessage(conversationId, messageId)) return null;
    return this.runTurn(conversationId);
  }

  /* ---------------------------------- internals ------------------------------- */

  /** Stream one assistant response for the current in-memory history. */
  private async runTurn(conversationId: string): Promise<ChatMessage | null> {
    const modelId = this.connections.loadedModelId as string;
    const controller = this.session.beginGeneration();
    if (controller === null) return null; // concurrency protection

    const assistantMessage = this.conversations.addMessage(conversationId, {
      role: 'assistant',
      content: '',
      status: 'pending',
      modelId
    });
    if (!assistantMessage) {
      this.session.endGeneration();
      return null;
    }

    const startedAtMs = Date.now();
    const state: TurnState = { content: '', reasoning: '', usage: undefined, firstContentAtMs: undefined };
    let streamError: string | undefined;
    let endedCleanly = false;

    // Watchdog for silent streams: a request queued behind LM Studio's single
    // generation slot delivers no data until the slot frees, which would hang
    // this turn forever with the "generating" lock held (blocking every later
    // send). Surface the wait, then abort cleanly after the hard timeout.
    let lastEventAtMs = Date.now();
    let watchdogFired = false;
    let watchdogReason = '';
    const watchdog = setInterval(() => {
      if (this.session.pastCeiling) {
        watchdogFired = true;
        watchdogReason = 'Generation exceeded the time limit.';
        controller.abort();
        return;
      }
      const silentFor = Date.now() - lastEventAtMs;
      if (silentFor >= ChatGenerationService.silentTimeoutMs) {
        watchdogFired = true;
        watchdogReason =
          'The model stayed silent for too long. It may be busy generating for another request — click Stop and try again.';
        controller.abort();
      } else if (silentFor >= ChatGenerationService.silentWarnMs) {
        this.phase.set(`${WAITING_PHASE_PREFIX} — the server may be busy generating another request…`);
      }
    }, 2_000);

    try {
      // Complete in-memory conversation history (system prompt included).
      const history = this.conversations.historyForRequest(conversationId);
      for await (const event of this.client.chatStream(this.connections.config, {
        modelId,
        messages: history,
        settings: this.settings.settings(),
        signal: controller.signal
      })) {
        lastEventAtMs = Date.now();
        // Tokens resumed — dismiss the "waiting" notice.
        if (this.phase()?.startsWith(WAITING_PHASE_PREFIX)) this.phase.set(null);
        this.applyEvent(event, conversationId, assistantMessage.id, state);
      }
      endedCleanly = true;
    } catch (err) {
      const e = toLmApiError(err);
      if (watchdogFired) {
        streamError = watchdogReason;
      } else {
        streamError = e.kind === 'aborted' ? 'Generation stopped' : e.message;
      }
    } finally {
      clearInterval(watchdog);
      this.session.endGeneration();
      this.phase.set(null);
    }

    // Finalize status.
    let status: ChatMessage['status'];
    if (streamError === 'Generation stopped') {
      // Stopping mid-thinking (reasoning only, no visible content yet) is still
      // a user cancellation — keep it distinct from a hard failure.
      status = state.content.length > 0 || state.reasoning.length > 0 ? 'cancelled' : 'failed';
    } else if (streamError !== undefined) {
      status = 'failed';
    } else if (!endedCleanly && state.content.length === 0) {
      // Stream ended without [DONE] and produced nothing — interrupted.
      status = 'failed';
      streamError = 'Stream ended unexpectedly.';
    } else {
      status = 'completed';
    }

    const totalElapsedMs = Date.now() - startedAtMs;
    const metrics = this.buildMetrics(startedAtMs, totalElapsedMs, state);
    this.conversations.updateMessage(conversationId, assistantMessage.id, {
      content: state.content,
      ...(state.reasoning.length > 0 ? { reasoning: state.reasoning } : {}),
      status,
      error: streamError,
      metrics
    });

    return this.conversations.findMessage(conversationId, assistantMessage.id) ?? null;
  }

  private applyEvent(event: StreamEvent, conversationId: string, messageId: string, state: TurnState): void {
    switch (event.kind) {
      case 'start':
        this.conversations.updateMessage(conversationId, messageId, { status: 'streaming' });
        break;
      case 'modelLoading':
        this.phase.set(event.detail?.trim() ? `Loading model — ${event.detail.trim()}` : 'Loading model…');
        break;
      case 'promptProcessing':
        this.phase.set(event.detail?.trim() ? event.detail.trim() : 'Processing prompt…');
        break;
      case 'reasoningDelta': {
        state.reasoning += event.text;
        if (state.firstContentAtMs === undefined) state.firstContentAtMs = Date.now();
        this.conversations.updateMessage(conversationId, messageId, { status: 'streaming', reasoning: state.reasoning });
        break;
      }
      case 'messageDelta': {
        state.content += event.text;
        if (state.firstContentAtMs === undefined) state.firstContentAtMs = Date.now();
        this.conversations.updateMessage(conversationId, messageId, { status: 'streaming', content: state.content });
        break;
      }
      case 'error':
        // Stream-level error events mark the message failed immediately.
        console.warn('[LocalBench] stream error event:', event.message);
        this.conversations.updateMessage(conversationId, messageId, { status: 'failed', error: event.message });
        break;
      case 'end':
        if (event.usage !== undefined) state.usage = { ...state.usage, ...event.usage };
        break;
    }
  }

  /** Build benchmark metrics from timing + server-reported usage. */
  buildMetrics(startedAtMs: number, totalElapsedMs: number, state: TurnState): ResponseMetrics {
    const metrics: ResponseMetrics = { totalElapsedMs };

    if (state.firstContentAtMs !== undefined) {
      metrics.timeToFirstTokenMs = Math.max(0, state.firstContentAtMs - startedAtMs);
    }
    if (state.usage?.promptTokens !== undefined) metrics.inputTokens = state.usage.promptTokens;
    if (state.usage?.completionTokens !== undefined) metrics.outputTokens = state.usage.completionTokens;
    if (state.usage?.reasoningTokens !== undefined) metrics.reasoningTokens = state.usage.reasoningTokens;

    // Tokens per second over the generation span (first token → end).
    const outputTokens = metrics.outputTokens;
    if (outputTokens !== undefined && metrics.timeToFirstTokenMs !== undefined) {
      const genSpanMs = Math.max(1, totalElapsedMs - metrics.timeToFirstTokenMs);
      metrics.tokensPerSecond = Math.round((outputTokens / (genSpanMs / 1000)) * 100) / 100;
    }

    // Model load time when measured during this session.
    const loadTime = this.lifecycle.lastLoadDurationMs();
    if (loadTime !== null && loadTime > 0) metrics.modelLoadTimeMs = loadTime;

    // Model instance identifier when the server reported one for this model.
    const instanceId = this.lifecycle.lastInstanceId();
    if (instanceId !== null) metrics.instanceId = instanceId;

    return metrics;
  }
}
