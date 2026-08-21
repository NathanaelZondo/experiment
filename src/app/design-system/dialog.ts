import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, effect, input, output } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { inject } from '@angular/core';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

/**
 * Accessible modal dialog: role="dialog", aria-modal, focus trap,
 * Esc to close, and focus restore to the previously focused element.
 */
@Component({
  selector: 'app-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="dialog-backdrop" (click)="close.emit()">
        <div
          #panel
          class="dialog-panel"
          role="dialog"
          aria-modal="true"
          [attr.aria-labelledby]="titleId"
          (keydown)="handleKeydown($event)"
        >
          @if (title()) {
            <header class="dialog-header">
              <h2 id="{{ titleId }}">{{ title() }}</h2>
              <button type="button" class="dialog-close" aria-label="Close dialog" (click)="close.emit()">×</button>
            </header>
          }
          <div class="dialog-body">
            <ng-content />
          </div>
        </div>
      </div>
    }
  `,
  styleUrl: './dialog.scss'
})
export class Dialog {
  readonly open = input(false);
  readonly title = input('');

  /** Fired on Esc key, backdrop click or the close button. */
  readonly close = output<void>();

  @ViewChild('panel') private panel?: ElementRef<HTMLDivElement>;

  private readonly documentRef = inject(DOCUMENT);
  private previouslyFocused: HTMLElement | null = null;

  /** Stable per-instance id so aria-labelledby stays consistent. */
  readonly titleId = `dialog-title-${Math.random().toString(36).slice(2, 8)}`;

  constructor() {
    // Move focus into the dialog when it opens; restore it when it closes.
    effect(() => {
      if (this.open()) {
        this.previouslyFocused = this.documentRef.activeElement as HTMLElement | null;
        requestAnimationFrame(() => this.focusFirst());
      } else if (this.previouslyFocused) {
        this.previouslyFocused?.focus();
        this.previouslyFocused = null;
      }
    });
  }

  /** Escape closes; Tab/Shift+Tab cycle inside the panel. */
  handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.close.emit();
      return;
    }
    if (event.key !== 'Tab' || !this.panel) {
      return;
    }
    const panel = this.panel.nativeElement;
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = this.documentRef.activeElement as HTMLElement | null;

    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusFirst(): void {
    const panel = this.panel?.nativeElement;
    if (!panel) {
      return;
    }
    // Prefer the first *actionable* control (e.g. the confirm button),
    // falling back to the panel itself.
    const focusable = panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusable ?? panel).focus();
  }
}
