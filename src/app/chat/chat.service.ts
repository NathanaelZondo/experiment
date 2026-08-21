import { Injectable, computed, inject, signal } from '@angular/core';
import { ConversationStore, Message } from '../conversation-store';
import { LmStudioService } from '../lmstudio/lm-studio.service';
import { LmStudioChatClient } from '../lmstudio/chat-client';
import { LmStudioRequestError } from '../lmstudio/lm-studio-client';
import { ChatMessage, ChatStats, ChatUsage } from '../lmstudio/chat-types';
import { GenerationSettingsService } from './generation-settings';

/** What the UI shows while a generation is in flight. */
export type GenerationActivity = 'waiting' | 'generating';

interface ActiveGeneration {
  conversationId: string;
  messageId: string;
  controller: AbortController;
}

/**
 * Orchestrates chat conversations against LM Studio (Phases 6 + 8).
 *
 * - Sends the per-conversation system prompt plus full history for multi-turn.
 * - Streams responses through a readable-stream SSE parser with live deltas.
 * - Enforces one generation at a time app-wide (concurrency protection) and
 *   blocks model load/unload while generating via LmStudioService.generating.
 * - Handles cancellation (AbortController), in-band errors, interrupted
 *   streams and missing-model guards; error text never contains the API token.
 * - Phase 8: regenerates the latest response, edits a user message and
 *   discards dependent responses before resending the revised history,
 *   deletes individual messages, clears conversations and applies the
 *   app-wide generation settings (temperature, top-p, …) to every request.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly store = inject(ConversationStore);
  private readonly lm = inject(LmStudioService);
  private readonly generationSettings = inject(GenerationSettingsService);
  private readonly client = new LmStudioChatClient();

  /** The in-flight generation, or null when idle. */
  private active: ActiveGeneration | null = null;

  /** True while a generation is in flight (drives the Stop button). */
  readonly generating = signal(false);
  /** Phase of the in-flight generation for the status line above the composer. */
  readonly activity = signal<GenerationActivity | null>(null);
  /** Set when sending was blocked because no model is loaded (cleared on next send attempt). */
  readonly noModelHint = signal(false);

  /** True while a generation is in flight — mirrors LmStudioService.generating. */
  readonly hasActiveGeneration = computed(() => this.active !== null);

  /**
   * Sends a user message and streams the assistant reply into the conversation.
   * No-ops when another generation is already running (concurrency protection).
   */
  send(conversationId: string, text: string): void {
    const trimmed = text.trim();
    if (!trimmed || this.active !== null) {
      return;
    }

    // Guard: a model must be loaded before chat can work.
    const model = this.lm.loadedModel();
    if (model === null) {
      this.noModelHint.set(true);
      return;
    }
    this.noModelHint.set(false);

    const conversation = this.store.get(conversationId);
    if (!conversation) {
      return;
    }

    // Append the user message and create a `sending` assistant placeholder.
    this.store.appendUserMessage(conversationId, trimmed);
    const reply = this.store.beginAssistantReply(conversationId);
    if (reply === null) {
      return;
    }

    void this.startGeneration(conversationId, reply.id, model.id);
  }

  /** Stops the in-flight generation, keeping any partial response. */
  stop(): void {
    if (this.active === null) {
      return;
    }
    const { conversationId, messageId } = this.active;
    this.store.stopAssistant(conversationId, messageId);
    this.active.controller.abort();
  }

  /**
   * Regenerates the latest assistant response: removes it and streams a fresh
   * reply from the remaining history. When the conversation ends on a user
   * message that never received a reply (e.g. sending was blocked because no
   * model was loaded), this generates the missing reply instead. No-ops while
   * another generation is in flight or when there is nothing to regenerate.
   */
  regenerateLatest(conversationId: string): void {
    if (this.active !== null) {
      return;
    }
    const model = this.lm.loadedModel();
    if (model === null) {
      this.noModelHint.set(true);
      return;
    }
    this.noModelHint.set(false);

    const conversation = this.store.get(conversationId);
    if (!conversation || conversation.messages.length === 0) {
      return;
    }

    let target: Message | undefined;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const m = conversation.messages[i];
      // In-flight and failed messages are not regenerated — a failure is not
      // context, so it never becomes part of the resent history either.
      if (m.status === 'sending' || m.status === 'failed') {
        continue;
      }
      target = m;
      break;
    }
    if (target === undefined) {
      return;
    }

    let replyId: string | null = null;
    if (target.role === 'assistant') {
      this.store.deleteMessage(conversationId, target.id);
      replyId = this.store.beginAssistantReply(conversationId)?.id ?? null;
    } else {
      // A trailing user message with no reply — generate the missing one.
      replyId = this.store.beginAssistantReply(conversationId)?.id ?? null;
    }
    if (replyId === null) {
      return;
    }

    void this.startGeneration(conversationId, replyId, model.id);
  }

  /**
   * Edits a user message and regenerates from that point: the revised text is
   * applied, every dependent response after it is discarded, and a fresh
   * assistant reply is streamed from the revised history. No-ops while another
   * generation is in flight; when no model is loaded the edit is still applied
   * (with its dependent responses discarded) so nothing stale survives.
   */
  editAndRegenerate(conversationId: string, messageId: string, text: string): void {
    if (this.active !== null) {
      return;
    }

    const conversation = this.store.get(conversationId);
    const message = conversation?.messages.find((m) => m.id === messageId);
    if (!conversation || !message || message.role !== 'user') {
      return;
    }

    // Apply the edit and discard everything that depended on it.
    if (!this.store.updateUserMessage(conversationId, messageId, text)) {
      return; // Blank edits are rejected — nothing to regenerate from.
    }
    this.store.removeMessagesAfter(conversationId, messageId);

    const model = this.lm.loadedModel();
    if (model === null) {
      this.noModelHint.set(true);
      return;
    }
    this.noModelHint.set(false);

    const reply = this.store.beginAssistantReply(conversationId);
    if (reply === null) {
      return;
    }

    void this.startGeneration(conversationId, reply.id, model.id);
  }

  /** Removes a single message. Refuses to delete the in-flight one. */
  deleteMessage(conversationId: string, messageId: string): void {
    if (this.active?.messageId === messageId) {
      return; // Stop it first — deleting an in-flight message would orphan its stream.
    }
    this.store.deleteMessage(conversationId, messageId);
  }

  /** Clears every message of a conversation, aborting any generation it owns. */
  clearConversation(conversationId: string): void {
    if (this.active?.conversationId === conversationId) {
      const { messageId } = this.active;
      this.store.stopAssistant(conversationId, messageId);
      this.active.controller.abort();
      // The stream's finally() settles the active state once it observes the abort.
    }
    this.store.clearMessages(conversationId);
  }

  /**
   * Shared generation pipeline for send / regenerate / edit-and-regenerate:
   * builds the request from the current store state, registers the in-flight
   * generation and streams the reply into `messageId`.
   */
  private startGeneration(conversationId: string, messageId: string, modelId: string): void {
    const conversation = this.store.get(conversationId);
    if (!conversation) {
      return;
    }

    const controller = new AbortController();
    this.active = { conversationId, messageId, controller };
    this.generating.set(true);
    this.activity.set('waiting');
    // Block model load/unload while generating (Phase 5 hook).
    this.lm.setGenerating(true);

    void this.runGeneration({ conversationId, messageId, controller }, this.buildMessages(conversation), modelId)
      .finally(() => {
        if (this.active?.messageId === messageId) {
          this.active = null;
          this.generating.set(false);
          this.activity.set(null);
          this.lm.setGenerating(false);
        }
      });
  }

  /** Builds the request payload: system prompt first, then full history. */
  private buildMessages(conversation: { systemPrompt: string; messages: Message[] }): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const systemPrompt = conversation.systemPrompt.trim();
    if (systemPrompt !== '') {
      messages.push({ role: 'system', content: systemPrompt });
    }
    for (const m of conversation.messages) {
      // In-flight placeholders and failed responses are not context.
      if (m.status === 'sending' || m.status === 'failed') {
        continue;
      }
      messages.push({ role: m.role, content: m.text });
    }
    return messages;
  }

  private async runGeneration(generation: ActiveGeneration, messages: ChatMessage[], modelId: string): Promise<void> {
    const { conversationId, messageId, controller } = generation;

    // Batched delta application: accumulate between microtasks so the store
    // (and thus markdown re-rendering) is not updated on every single token.
    let pendingText = '';
    let pendingReasoning = '';
    let flushScheduled = false;
    const flush = (): void => {
      if (!flushScheduled && (pendingText !== '' || pendingReasoning !== '')) {
        flushScheduled = true;
        queueMicrotask(() => {
          flushScheduled = false;
          if (pendingText !== '') {
            this.store.updateAssistantText(conversationId, messageId, this.currentText(messageId) + pendingText);
            pendingText = '';
          }
          if (pendingReasoning !== '') {
            this.store.appendReasoning(conversationId, messageId, pendingReasoning);
            pendingReasoning = '';
          }
        });
      }
    };

    let sawFinish = false;
    let finishUsage: ChatUsage | undefined;
    let finishStats: ChatStats | undefined;
    let inBandError: string | null = null;

    try {
      // App-wide generation settings are applied to every request.
      const options = this.generationSettings.requestOptions();
      await this.client.stream(
        this.lm.serverUrl(),
        modelId,
        messages,
        (event) => {
          if (event.kind === 'delta') {
            if (this.activity() === 'waiting') {
              this.activity.set('generating');
            }
            if (event.delta.contentChanged && event.delta.content !== undefined) {
              pendingText += event.delta.content;
            }
            if (event.delta.reasoningChanged && event.delta.reasoningContent !== undefined) {
              pendingReasoning += event.delta.reasoningContent;
            }
            flush();
          } else if (event.kind === 'finish') {
            sawFinish = true;
            finishUsage = event.usage ?? finishUsage;
            finishStats = event.stats ?? finishStats;
          } else if (event.kind === 'error') {
            inBandError = event.message;
          }
        },
        options,
        this.lm.apiToken() || undefined,
        controller.signal
      );

      // Ensure any batched tail is applied before finalizing.
      flush();
      await new Promise<void>((resolve) => queueMicrotask(resolve));

      if (inBandError !== null) {
        this.store.failAssistant(conversationId, messageId, inBandError);
        return;
      }

      const text = this.currentText(messageId);
      if (!sawFinish && text === '') {
        // The stream ended without any content or a finish frame — treat as failed.
        this.store.failAssistant(
          conversationId,
          messageId,
          'The response stream ended unexpectedly.',
          ['Check that the model is fully loaded and try again.']
        );
        return;
      }

      // Prefer aggregated stats from the final chunk; keep partial text when
      // the stream was interrupted before its finish frame.
      this.store.completeAssistant(conversationId, messageId, {
        usage: finishUsage,
        stats: finishStats,
        modelId,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        // User-initiated stop — the partial response was already kept by stop().
        return;
      }
      const classification = error instanceof LmStudioRequestError ? error.classification : null;
      this.store.failAssistant(
        conversationId,
        messageId,
        classification?.message ?? 'The request failed unexpectedly.',
        classification?.guidance ?? ['Check the server URL and try again.']
      );
    }
  }

  private currentText(messageId: string): string {
    // The message may live in any conversation; scan for it.
    for (const c of this.store.conversations()) {
      const found = c.messages.find((m) => m.id === messageId);
      if (found !== undefined) {
        return found.text;
      }
    }
    return '';
  }
}
