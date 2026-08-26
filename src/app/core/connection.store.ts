/**
 * Connection store (in-memory only).
 *
 * Holds the editable LM Studio server URL and optional API token (RAM only —
 * never persisted, never logged), the connection state machine
 * (disconnected → checking → connected | failed) and the discovered model
 * catalogue. Discovery uses the native GET /api/v1/models endpoint.
 */

import { Injectable, signal } from '@angular/core';
import { LmStudioClient, type ClientConfig, normalizeBaseUrl } from './lm-studio-client.service';
import { toLmApiError } from './api-error';
import { environment } from './environment';
import type { CatalogModel, ConnectionResult, ConnectionStatus } from './types/lm-studio.types';

@Injectable({ providedIn: 'root' })
export class ConnectionStore {
  private readonly client = new LmStudioClient();

  /** Editable server URL (RAM only). */
  readonly serverUrl = signal(environment.lmStudioUrl);
  /** Optional API token (RAM only; never logged or returned in errors). */
  readonly apiToken = signal('');
  readonly status = signal<ConnectionStatus>('disconnected');
  readonly lastError = signal<string | null>(null);
  readonly models = signal<CatalogModel[]>([]);

  /** Currently loaded model id, when the server reports one. */
  get loadedModelId(): string | null {
    return this.models().find((m) => m.loaded)?.id ?? null;
  }

  get config(): ClientConfig {
    return { baseUrl: this.serverUrl(), apiToken: this.apiToken() || undefined };
  }

  setServerUrl(url: string): void {
    const next = normalizeBaseUrl(url.trim());
    if (next === this.serverUrl()) return;
    this.serverUrl.set(next);
    // The catalogue belongs to the previous server — drop it.
    this.models.set([]);
    this.status.set('disconnected');
  }

  setApiToken(token: string): void {
    this.apiToken.set(token);
  }

  /** Connection test using GET /api/v1/models (native discovery). */
  async testConnection(): Promise<ConnectionResult> {
    this.status.set('checking');
    this.lastError.set(null);
    try {
      const models = await this.client.listModels(this.config);
      this.models.set(models);
      this.status.set('connected');
      return { ok: true, status: 'connected', models };
    } catch (err) {
      const e = toLmApiError(err);
      if (e.kind === 'aborted') {
        // Cancellation is not a failure state.
        this.status.set('disconnected');
        return { ok: false, status: 'failed', error: e.message };
      }
      this.lastError.set(e.message);
      this.status.set('failed');
      return { ok: false, status: 'failed', error: e.message };
    }
  }

  /** Re-fetch the model list after lifecycle operations (keeps loaded flags fresh). */
  async refreshModels(): Promise<void> {
    if (this.status() !== 'connected') return;
    try {
      const models = await this.client.listModels(this.config);
      this.models.set(models);
    } catch {
      // Best effort: keep the previous catalogue on a transient failure.
    }
  }

  /** Clear cached state (e.g. after switching servers). */
  reset(): void {
    this.status.set('disconnected');
    this.lastError.set(null);
    this.models.set([]);
  }

  /* ---------------------------- auto-reconnect ----------------------------- */

  private monitorTimer: number | null = null;

  private maybeRecheck(): void {
    if (this.status() === 'connected' || this.status() === 'checking') return;
    void this.testConnection();
  }

  private readonly onFocus = (): void => this.maybeRecheck();

  /**
   * Lightweight auto-reconnect: while the server is unreachable (not started
   * yet, restarting, dropped), re-probe on an interval and whenever the page
   * regains focus so the status badge recovers without a manual
   * "Test connection" click. No-op while connected / while a probe is in flight.
   */
  startAutoReconnect(intervalMs = 15_000): void {
    if (this.monitorTimer !== null) return;
    this.monitorTimer = window.setInterval(() => this.maybeRecheck(), intervalMs);
    window.addEventListener('focus', this.onFocus);
  }

  /** Stop the auto-reconnect watcher (mostly for tests). */
  stopAutoReconnect(): void {
    if (this.monitorTimer !== null) {
      window.clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    window.removeEventListener('focus', this.onFocus);
  }
}
