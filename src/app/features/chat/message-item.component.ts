import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { ChatMessage } from '../../core/types/lm-studio.types';
import { MarkdownPipe } from '../../shared/markdown/markdown.pipe';
import { DurationPipe, MetricPipe } from '../../shared/pipes/format.pipe';
import { Button } from '../../shared/ui/button.component';
import { IconButton } from '../../shared/ui/icon-button.component';
import { Tooltip } from '../../shared/ui/tooltip.component';

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/**
 * One chat message. Assistant messages render sanitized markdown with copyable
 * code blocks, a collapsible reasoning section and expandable benchmark
 * metrics; user messages offer edit-and-regenerate. All actions are delegated
 * to the parent via outputs so history mutations stay in one place.
 */
@Component({
  selector: 'app-message-item',
  imports: [FormsModule, MarkdownPipe, DurationPipe, MetricPipe, Button, IconButton, Tooltip],
  templateUrl: './message-item.component.html',
  styleUrl: './message-item.component.scss'
})
export class MessageItem {
  private readonly clipboard = inject(Navigator).clipboard;

  readonly message = input.required<ChatMessage>();
  /** True for the latest assistant response (enables regenerate). */
  readonly isLatestAssistant = input(false);

  /** User message edited → parent discards dependents and resends. */
  readonly edited = output<{ messageId: string; content: string }>();
  /** Regenerate requested on this (latest) assistant message. */
  readonly regenerated = output<void>();
  /** Delete requested for this message id. */
  readonly deleteRequested = output<string>();

  protected readonly showMetrics = signal(false);
  protected readonly editing = signal(false);
  protected readonly editValue = signal('');
  protected readonly copiedFlash = signal(false);

  protected readonly isUser = computed(() => this.message().role === 'user');
  protected readonly timeLabel = computed(() => TIME_FORMAT.format(new Date(this.message().createdAt)));

  /** True while the assistant response is still being generated (drives the live "Thinking…" view). */
  protected readonly isThinking = computed(() => {
    const status = this.message().status;
    return status === 'pending' || status === 'streaming';
  });

  /** Metrics JSON payload for the copy-results action. */
  protected get metricsJson(): string {
    const m = this.message();
    return JSON.stringify(
      {
        model: m.modelId ?? null,
        timestamp: new Date(m.createdAt).toISOString(),
        status: m.status,
        error: m.error ?? null,
        metrics: m.metrics ?? {}
      },
      null,
      2
    );
  }

  /* --------------------------------- actions -------------------------------- */

  startEdit(): void {
    this.editValue.set(this.message().content);
    this.editing.set(true);
  }

  cancelEdit(): void {
    this.editing.set(false);
  }

  commitEdit(): void {
    const value = this.editValue().trim();
    if (!value) return;
    this.edited.emit({ messageId: this.message().id, content: value });
    this.editing.set(false);
  }

  /** Copy a text payload with transient "Copied" feedback. */
  async copyText(text: string): Promise<void> {
    try {
      await this.clipboard.writeText(text);
      this.copiedFlash.set(true);
      setTimeout(() => this.copiedFlash.set(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / non-secure context) — fail quietly.
    }
  }

  /** Event delegation for copy buttons rendered inside markdown code blocks. */
  onMarkdownClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    const button = target?.closest('.lb-code-copy') as HTMLButtonElement | null;
    if (!button) return;
    const block = button.closest('.lb-code-block');
    const code = block?.querySelector('code')?.textContent ?? '';
    void this.copyText(code);
  }

  protected formatTime(ts: number): string {
    return TIME_FORMAT.format(new Date(ts));
  }

  /** ISO timestamp for the <time datetime="…"> attribute. */
  protected isoTimestamp(ts: number): string {
    return new Date(ts).toISOString();
  }
}
