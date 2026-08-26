/**
 * Chat session store (in-memory only).
 *
 * Tracks the single in-flight generation request. LM Studio serves exactly one
 * loaded model, so at most one chat stream may be active at a time; this store
 * provides the concurrency guard and the AbortController used by the
 * stop-generation button.
 */

import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ChatSessionStore {
  /**
   * Absolute time cap for one generation (safety net against a runaway stream
   * that never terminates). Mutable so tests can shrink it.
   */
  static ceilingMs = 10 * 60_000;

  readonly isGenerating = signal(false);
  private controller: AbortController | null = null;
  private startedAtMs = 0;

  /** True while a generation request is in flight. */
  get active(): boolean {
    return this.isGenerating();
  }

  /** True once the current generation has exceeded the absolute time cap. */
  get pastCeiling(): boolean {
    return this.controller !== null && Date.now() - this.startedAtMs >= ChatSessionStore.ceilingMs;
  }

  /**
   * Begin a new generation. Returns an AbortController whose signal must be
   * passed to the client, or `null` when another request is already running
   * (concurrency protection).
   */
  beginGeneration(): AbortController | null {
    if (this.controller !== null) return null;
    this.controller = new AbortController();
    this.startedAtMs = Date.now();
    this.isGenerating.set(true);
    return this.controller;
  }

  /** Cancel the in-flight generation (stop button / user abort). */
  cancel(): void {
    this.controller?.abort();
  }

  /** Mark the current generation as finished. */
  endGeneration(): void {
    this.controller = null;
    this.startedAtMs = 0;
    this.isGenerating.set(false);
  }
}
