import { Component, input } from '@angular/core';

/** Lightweight CSS tooltip; visible on hover and keyboard focus (focus-within). */
@Component({
  selector: 'app-tooltip',
  template: `<span class="lb-tip" [attr.data-tip]="text()"><ng-content /></span>`,
  styles: `
    .lb-tip {
      position: relative;
      display: inline-flex;

      &::after {
        content: attr(data-tip);
        position: absolute;
        bottom: calc(100% + 6px);
        left: 50%;
        transform: translateX(-50%) scale(0.96);
        background: var(--surface-3);
        color: var(--text-primary);
        border: 1px solid var(--border);
        padding: 4px 8px;
        border-radius: var(--radius-sm);
        font-size: 12px;
        font-weight: 500;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity var(--motion-fast), transform var(--motion-fast);
        z-index: 60;
      }

      &:hover::after,
      &:focus-within::after {
        opacity: 1;
        transform: translateX(-50%) scale(1);
      }
    }
  `
})
export class Tooltip {
  readonly text = input.required<string>();
}
