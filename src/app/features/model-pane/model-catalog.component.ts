import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConnectionStore } from '../../core/connection.store';
import { ModelLifecycleStore } from '../../core/model-lifecycle.store';
import { ChatSessionStore } from '../../core/chat-session.store';
import type { CatalogModel } from '../../core/types/lm-studio.types';
import { Button } from '../../shared/ui/button.component';
import { Skeleton } from '../../shared/ui/skeleton.component';
import { EmptyState } from '../../shared/ui/empty-state.component';
import { BytesPipe, DurationPipe } from '../../shared/pipes/format.pipe';

/**
 * Model catalogue (right-hand panel).
 *
 * Layout contract (Known Issue 2): the list lives in a bounded scroll region —
 * `flex: 1; min-height: 0; overflow-y: auto` inside the fixed-width right panel —
 * so a long model list scrolls internally and can never displace the centre
 * conversation area.
 */
@Component({
  selector: 'app-model-catalog',
  imports: [FormsModule, Button, Skeleton, EmptyState, BytesPipe, DurationPipe],
  templateUrl: './model-catalog.component.html',
  styleUrl: './model-catalog.component.scss'
})
export class ModelCatalog {
  private readonly connections = inject(ConnectionStore);
  private readonly lifecycle = inject(ModelLifecycleStore);
  private readonly session = inject(ChatSessionStore);

  protected readonly models = this.connections.models;
  protected readonly status = this.connections.status;
  protected readonly loading = this.lifecycle.loading;
  protected readonly lifecycleError = this.lifecycle.lifecycleError;
  protected readonly lastLoadDurationMs = this.lifecycle.lastLoadDurationMs;
  protected readonly generating = this.session.isGenerating;

  /** Filter to chat-capable LLMs (default on). */
  protected readonly chatOnly = signal(true);

  protected readonly visibleModels = computed(() => {
    const list = this.models();
    return this.chatOnly() ? list.filter((m) => m.chatCapable) : list;
  });

  /** Ticking clock for the loading overlay's elapsed time. */
  private readonly nowMs = signal(Date.now());

  constructor() {
    // Tick the elapsed-time clock while a load is in progress; the cleanup
    // callback stops it when the load ends or the component is destroyed.
    effect(() => {
      const state = this.lifecycle.loading();
      if (state === null) return;
      this.nowMs.set(Date.now());
      const timer = setInterval(() => this.nowMs.set(Date.now()), 500);
      return () => clearInterval(timer);
    });
  }

  protected get loadingElapsedMs(): number | null {
    const state = this.loading();
    return state ? Math.max(0, this.nowMs() - state.startedAtMs) : null;
  }

  /** Lifecycle busy (loading or generating) — blocks load/unload actions. */
  protected get busy(): boolean {
    return this.lifecycle.busy || this.generating();
  }

  protected loadModel(model: CatalogModel): void {
    if (this.lifecycle.busy || !model.chatCapable) return;
    void this.lifecycle.loadModel(model.id);
  }

  protected unloadModel(): void {
    if (this.lifecycle.busy) return;
    void this.lifecycle.unloadModel();
  }

  protected clearError(): void {
    this.lifecycle.clearError();
  }
}
