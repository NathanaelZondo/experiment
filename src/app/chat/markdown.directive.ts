import { Directive, ElementRef, Input, OnChanges, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { renderMarkdown } from './markdown';

/**
 * Renders markdown into the host element. Sanitized by construction (see
 * `markdown.ts`) — no innerHTML is ever used. Re-renders whenever `text`
 * changes, which drives live streaming updates as deltas arrive.
 */
@Directive({ selector: '[markdown]' })
export class Markdown implements OnChanges, OnDestroy {
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly documentRef = inject(DOCUMENT);

  /** The markdown source to render. */
  @Input('markdown') text = '';

  ngOnChanges(): void {
    this.render();
  }

  ngOnDestroy(): void {
    // Detach any copy-button listeners by clearing the rendered content.
    this.elementRef.nativeElement.innerHTML = '';
  }

  private render(): void {
    const host = this.elementRef.nativeElement;
    host.textContent = '';
    if (this.text === '') {
      return;
    }
    renderMarkdown(this.text, host, this.documentRef);
  }
}
