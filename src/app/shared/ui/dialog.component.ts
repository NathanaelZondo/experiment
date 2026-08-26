import { Component, ElementRef, HostListener, effect, input, model, viewChild } from '@angular/core';

/**
 * Accessible modal dialog: role="dialog", aria-modal, Escape to close (even
 * when focus has left the panel), backdrop click to close, focus moved into
 * the panel on open and restored to the trigger element on close.
 */
@Component({
  selector: 'app-dialog',
  templateUrl: './dialog.component.html',
  styleUrl: './dialog.component.scss'
})
export class Dialog {
  /** Two-way open state (signal model). */
  readonly open = model(false);
  readonly title = input.required<string>();

  protected readonly panel = viewChild<ElementRef<HTMLDivElement>>('panel');
  private previousFocus: HTMLElement | null = null;

  constructor() {
    // Move focus into the dialog when it opens.
    effect(() => {
      if (this.open()) {
        this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        this.panel()?.nativeElement.focus();
      }
    });
  }

  @HostListener('document:keydown.escape')
  onDocumentEscape(): void {
    if (this.open()) this.close();
  }

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    const restore = this.previousFocus;
    this.previousFocus = null;
    restore?.focus();
  }
}
