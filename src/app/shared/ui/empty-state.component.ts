import { Component, input } from '@angular/core';

/** Friendly empty state with title, hint and an optional action slot. */
@Component({
  selector: 'app-empty-state',
  templateUrl: './empty-state.component.html',
  styles: `
    .lb-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-2);
      text-align: center;
      padding: var(--space-6) var(--space-4);
      color: var(--text-secondary);

      svg {
        width: 34px;
        height: 34px;
        color: var(--text-muted);
      }
    }

    .lb-empty__title {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .lb-empty__hint {
      margin: 0;
      font-size: 13px;
      max-width: 42ch;
    }

    .lb-empty__action {
      margin-top: var(--space-2);
    }
  `
})
export class EmptyState {
  readonly title = input.required<string>();
  readonly hint = input('');
}
