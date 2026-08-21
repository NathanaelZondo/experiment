import { Injectable, computed, signal } from '@angular/core';
import { LmStudioClient, DEFAULT_LM_STUDIO_URL, LmStudioRequestError } from './lm-studio-client';
import { normalizeBaseUrl } from './format';
import { AppliedLoadConfig, ConnectionStatus, LifecyclePhase, LmStudioConnectionError, LmStudioModel } from './types';

/** Abort a connection test after this long so "checking" never hangs. */
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Holds the LM Studio connection state in RAM only — server URL and API token
 * are editable signals, nothing is persisted to localStorage or anywhere else,
 * so refreshing the page resets both to their defaults.
 */
@Injectable({ providedIn: 'root' })
export class LmStudioService {
  private readonly client = new LmStudioClient();

  /** Editable server URL (RAM only). */
  readonly serverUrl = signal(DEFAULT_LM_STUDIO_URL);
  /** Optional API token (RAM only, never logged or echoed into error messages). */
  readonly apiToken = signal('');

  readonly status = signal<ConnectionStatus>('disconnected');
  readonly error = signal<LmStudioConnectionError | null>(null);
  readonly models = signal<LmStudioModel[]>([]);
  /** Timestamp of the last successful connection test, or null. */
  readonly lastCheckedAt = signal<number | null>(null);

  /** When true, only chat-capable LLMs are shown in the catalogue. */
  readonly chatOnly = signal(false);

  /** Models after applying the chat-only filter. */
  readonly visibleModels = computed(() => {
    const all = this.models();
    if (!this.chatOnly()) {
      return all;
    }
    return all.filter((m) => m.capabilities.includes('chat'));
  });

  /** True while a connection test is in flight. */
  readonly checking = computed(() => this.status() === 'checking');

  /** The currently loaded model (or null when nothing is loaded). */
  readonly loadedModel = computed<LmStudioModel | null>(() => this.models().find((m) => m.loaded) ?? null);

  /** True when exactly one model is loaded and ready for chat. */
  readonly hasLoadedModel = computed(() => this.loadedModel() !== null);

  // --- One-model-at-a-time model lifecycle (Phase 5) -------------------

  /** Current lifecycle phase; 'idle' means no load/unload is in flight. */
  readonly lifecyclePhase = signal<LifecyclePhase>('idle');
  /** Model id targeted by the in-flight operation, or null when idle. */
  readonly loadingModelId = signal<string | null>(null);
  /** Start timestamp of the current lifecycle operation (drives elapsed time). */
  readonly lifecycleStartedAt = signal<number | null>(null);
  /** Final applied load configuration from the last successful load. */
  readonly lastAppliedConfig = signal<AppliedLoadConfig | null>(null);
  /** Lifecycle failure with guidance, or null when there is none. */
  readonly lifecycleError = signal<LmStudioConnectionError | null>(null);
  /** True while a chat generation is in flight — blocks lifecycle changes. */
  readonly generating = signal(false);

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  /** Ticks once per second while an operation is in flight (drives the elapsed-time display). */
  readonly now = signal(Date.now());

  /** Elapsed milliseconds of the in-flight lifecycle operation (0 when idle). */
  readonly lifecycleElapsedMs = computed(() => {
    const started = this.lifecycleStartedAt();
    return started === null ? 0 : Math.max(0, this.now() - started);
  });

  private sequence = 0;
  private lifecycleSequence = 0;

  /** Runs GET /api/v1/models and drives the status state machine. */
  async testConnection(): Promise<void> {
    const baseUrl = normalizeBaseUrl(this.serverUrl());
    if (baseUrl === '') {
      this.error.set({
        kind: 'http',
        message: 'Enter a server URL first.',
        guidance: ['The default LM Studio address is http://localhost:1234.'],
      });
      this.status.set('failed');
      return;
    }

    const mySequence = ++this.sequence;
    this.status.set('checking');
    this.error.set(null);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const token = this.apiToken().trim();
      const models = await this.client.listModels(baseUrl, token === '' ? undefined : token, controller.signal);
      if (mySequence !== this.sequence) {
        return; // A newer test superseded this one.
      }
      this.models.set(models);
      this.lastCheckedAt.set(Date.now());
      this.status.set('connected');
    } catch (error) {
      if (mySequence !== this.sequence) {
        return;
      }
      const classification = error instanceof LmStudioRequestError ? error.classification : classifyUnknown(error);
      // Drop stale catalogue data so a failed re-test never shows old models.
      this.models.set([]);
      this.lastCheckedAt.set(null);
      this.error.set(classification);
      this.status.set('failed');
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Cancels any in-flight test and returns to the disconnected state. */
  reset(): void {
    this.sequence += 1;
    this.status.set('disconnected');
    this.error.set(null);
    this.models.set([]);
    this.lastCheckedAt.set(null);
    // A different server invalidates any in-flight lifecycle and applied config.
    this.lifecycleSequence += 1;
    this.lifecyclePhase.set('idle');
    this.loadingModelId.set(null);
    this.lifecycleStartedAt.set(null);
    this.lifecycleError.set(null);
    this.lastAppliedConfig.set(null);
    this.stopTicking();
  }

  /** Changing the URL or token invalidates any previous result. */
  setServerUrl(url: string): void {
    this.serverUrl.set(normalizeBaseUrl(url));
    if (this.status() === 'connected' || this.status() === 'failed') {
      this.reset();
    }
  }

  setApiToken(token: string): void {
    this.apiToken.set(token);
    if (this.status() === 'connected' || this.status() === 'failed') {
      this.reset();
    }
  }

  /** Marks a chat generation as active/inactive. While generating, load/unload are blocked. */
  setGenerating(active: boolean): void {
    this.generating.set(active);
  }

  /**
   * Loads the given model with LM Studio defaults (no advanced settings). If another
   * model is currently loaded it is unloaded first — one model at a time. No-ops
   * while a lifecycle operation or a chat generation is in flight. Resolves after
   * the catalogue has been refreshed so loaded flags are accurate.
   */
  async loadModel(modelId: string): Promise<void> {
    const id = modelId.trim();
    if (id === '' || this.lifecyclePhase() !== 'idle' || this.generating()) {
      return;
    }

    const mySequence = ++this.lifecycleSequence;
    this.lifecycleError.set(null);
    this.loadingModelId.set(id);
    this.lifecycleStartedAt.set(Date.now());
    this.startTicking();

    let unloadedFirst: string | null = null;
    try {
      // One model at a time: unload any other loaded model before loading.
      const current = this.models().find((m) => m.loaded && m.id !== id);
      if (current) {
        this.lifecyclePhase.set('unloading');
        await this.client.unloadModel(this.baseUrl(), current.id, this.token());
        if (mySequence !== this.lifecycleSequence) {
          return; // superseded by a newer operation
        }
        unloadedFirst = current.id;
        // Reflect the unload locally so the UI stays accurate even if the replacement fails.
        this.models.update((list) => list.map((m) => (m.id === current.id ? { ...m, loaded: false } : m)));
      }

      this.lifecyclePhase.set('loading');
      const config = await this.client.loadModel(this.baseUrl(), id, this.token());
      if (mySequence !== this.lifecycleSequence) {
        return; // superseded by a newer operation
      }
      this.lastAppliedConfig.set(config);
    } catch (error) {
      if (mySequence === this.lifecycleSequence) {
        const classification = error instanceof LmStudioRequestError ? error.classification : classifyUnknown(error);
        if (unloadedFirst !== null) {
          // The old model is gone but the replacement failed — say so explicitly.
          this.lifecycleError.set({
            kind: classification.kind,
            message: `“${unloadedFirst}” was unloaded but “${id}” could not be loaded.`,
            guidance: [
              ...classification.guidance,
              'No model is currently loaded — load one from the catalogue when ready.',
            ],
          });
        } else {
          this.lifecycleError.set(classification);
        }
      }
    } finally {
      if (mySequence === this.lifecycleSequence) {
        this.finishLifecycle();
      }
    }

    // Refresh model state after every lifecycle operation.
    if (mySequence === this.lifecycleSequence) {
      await this.refreshCatalog();
    }
  }

  /**
   * Unloads the given model, or the first loaded one when no id is given. No-ops
   * while a lifecycle operation or a chat generation is in flight, and when
   * nothing is loaded. Resolves after the catalogue has been refreshed.
   */
  async unloadModel(modelId?: string): Promise<void> {
    if (this.lifecyclePhase() !== 'idle' || this.generating()) {
      return;
    }
    const target = modelId ? this.models().find((m) => m.id === modelId && m.loaded) : this.models().find((m) => m.loaded);
    if (!target) {
      return; // Nothing loaded — nothing to do.
    }

    const mySequence = ++this.lifecycleSequence;
    this.lifecycleError.set(null);
    this.loadingModelId.set(target.id);
    this.lifecycleStartedAt.set(Date.now());
    this.startTicking();

    try {
      this.lifecyclePhase.set('unloading');
      await this.client.unloadModel(this.baseUrl(), target.id, this.token());
      if (mySequence !== this.lifecycleSequence) {
        return; // superseded by a newer operation
      }
    } catch (error) {
      if (mySequence === this.lifecycleSequence) {
        const classification = error instanceof LmStudioRequestError ? error.classification : classifyUnknown(error);
        this.lifecycleError.set(classification);
      }
    } finally {
      if (mySequence === this.lifecycleSequence) {
        this.finishLifecycle();
      }
    }

    // Refresh model state after every lifecycle operation.
    if (mySequence === this.lifecycleSequence) {
      await this.refreshCatalog();
    }
  }

  /** Re-fetches the catalogue so loaded flags are accurate after a lifecycle operation. */
  private async refreshCatalog(): Promise<void> {
    const baseUrl = this.baseUrl();
    if (baseUrl === '') {
      return;
    }
    try {
      const models = await this.client.listModels(baseUrl, this.token());
      this.models.set(models);
      this.lastCheckedAt.set(Date.now());
      // A successful fetch proves the server is reachable.
      if (this.status() !== 'connected') {
        this.status.set('connected');
        this.error.set(null);
      }
    } catch {
      // Keep the last known catalogue — a refresh failure must not break the lifecycle.
    }
  }

  private finishLifecycle(): void {
    this.lifecyclePhase.set('idle');
    this.loadingModelId.set(null);
    this.lifecycleStartedAt.set(null);
    this.stopTicking();
  }

  private startTicking(): void {
    if (this.tickTimer !== null) {
      return;
    }
    this.now.set(Date.now());
    this.tickTimer = setInterval(() => this.now.set(Date.now()), 1000);
  }

  private stopTicking(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private baseUrl(): string {
    return normalizeBaseUrl(this.serverUrl());
  }

  private token(): string | undefined {
    const trimmed = this.apiToken().trim();
    return trimmed === '' ? undefined : trimmed;
  }
}

function classifyUnknown(error: unknown): LmStudioConnectionError {
  return {
    kind: 'http',
    message: error instanceof Error ? error.message : 'Unexpected error while contacting LM Studio.',
    guidance: ['Check the server URL and try again.'],
  };
}
