/**
 * Model lifecycle store (in-memory only).
 *
 * Implements the one-model-at-a-time load/unload lifecycle against LM Studio's
 * native endpoints:
 *   - POST /api/v1/models/load
 *   - POST /api/v1/models/unload
 *
 * Rules enforced here:
 *  - If another model is active it is unloaded before loading the new one.
 *  - Lifecycle changes are blocked while a generation request is in flight.
 *  - Model state is refreshed after every lifecycle operation.
 *  - If unloading succeeds but loading the replacement fails, the previous
 *    model is reloaded to recover gracefully.
 */

import { Injectable, signal } from '@angular/core';
import { LmStudioClient } from './lm-studio-client.service';
import { toLmApiError } from './api-error';
import { ConnectionStore } from './connection.store';
import { ChatSessionStore } from './chat-session.store';

export interface LoadingState {
  modelId: string;
  startedAtMs: number;
}

@Injectable({ providedIn: 'root' })
export class ModelLifecycleStore {
  private readonly client = new LmStudioClient();

  /** Non-null while a load is in progress (drives the loading overlay). */
  readonly loading = signal<LoadingState | null>(null);
  /** Measured duration of the most recent successful load (for benchmark metrics). */
  readonly lastLoadDurationMs = signal<number | null>(null);
  /** Instance identifier of the most recently loaded model (for benchmark metrics + unload). */
  readonly lastInstanceId = signal<string | null>(null);
  readonly lifecycleError = signal<string | null>(null);

  constructor(
    private readonly connections: ConnectionStore,
    private readonly session: ChatSessionStore
  ) {}

  get busy(): boolean {
    return this.loading() !== null || this.session.active;
  }

  /** Instance id of a catalogue entry (when the server reports one). */
  private findInstanceId(modelId: string | null): string | undefined {
    if (!modelId) return undefined;
    return this.connections.models().find((m) => m.id === modelId)?.instanceId;
  }

  /** Load `modelId`, unloading the currently active model first when needed. */
  async loadModel(modelId: string): Promise<boolean> {
    if (this.busy) return false; // blocked while generating or loading
    const config = this.connections.config;
    const previousId = this.connections.loadedModelId;

    let unloadedPrevious = false;
    try {
      if (previousId !== null && previousId !== modelId) {
        await this.client.unloadModel(config, this.findInstanceId(previousId));
        unloadedPrevious = true;
        this.lastInstanceId.set(null);
        await this.connections.refreshModels(); // refresh after every lifecycle operation
      }

      const startedAtMs = Date.now();
      this.loading.set({ modelId, startedAtMs });
      let instanceIdFromResponse: string | undefined;
      try {
        const result = await this.client.loadModel(config, modelId);
        this.lastLoadDurationMs.set(Date.now() - startedAtMs);
        if (result && typeof result.instance_id === 'string' && result.instance_id.length > 0) {
          instanceIdFromResponse = result.instance_id;
        }
      } finally {
        this.loading.set(null);
      }

      this.lifecycleError.set(null);
      await this.connections.refreshModels(); // refresh after every lifecycle operation
      // Prefer the instance id the server reported on load; fall back to the catalogue.
      this.lastInstanceId.set(instanceIdFromResponse ?? this.findInstanceId(this.connections.loadedModelId) ?? null);
      return true;
    } catch (err) {
      const e = toLmApiError(err);
      if (unloadedPrevious && previousId !== null) {
        // Unload succeeded but the replacement failed — try to restore the previous model.
        this.lifecycleError.set(
          `Loading ${modelId} failed after unloading ${previousId}. Attempting to restore the previous model…`
        );
        try {
          await this.client.loadModel(config, previousId);
          this.lifecycleError.set(`Restored ${previousId} after the load failure.`);
        } catch (restoreErr) {
          const re = toLmApiError(restoreErr);
          this.lifecycleError.set(
            `Loading ${modelId} failed and restoring ${previousId} also failed: ${re.message}`
          );
        }
      } else {
        this.lifecycleError.set(e.kind === 'aborted' ? null : e.message);
      }
      await this.connections.refreshModels(); // best-effort state sync
      // Re-sync the instance id to whatever is actually loaded now.
      this.lastInstanceId.set(this.findInstanceId(this.connections.loadedModelId) ?? null);
      return false;
    }
  }

  /** Unload the currently loaded model. */
  async unloadModel(): Promise<boolean> {
    if (this.busy) return false;
    const config = this.connections.config;
    try {
      await this.client.unloadModel(config, this.findInstanceId(this.connections.loadedModelId));
      this.lifecycleError.set(null);
      this.lastInstanceId.set(null);
      await this.connections.refreshModels(); // refresh after every lifecycle operation
      return true;
    } catch (err) {
      const e = toLmApiError(err);
      if (e.kind !== 'aborted') this.lifecycleError.set(e.message);
      await this.connections.refreshModels();
      return false;
    }
  }

  /** Clear a transient lifecycle error message. */
  clearError(): void {
    this.lifecycleError.set(null);
  }
}
