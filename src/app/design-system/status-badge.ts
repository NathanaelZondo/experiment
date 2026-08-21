import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'danger' | 'success';

@Component({
  selector: 'app-status-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="badge" [class]="classes()">
      @if (tone() !== 'neutral') {
        <span class="badge-dot" aria-hidden="true"></span>
      }
      {{ text() }}
    </span>
  `,
  styleUrl: './status-badge.scss'
})
export class StatusBadge {
  readonly text = input.required<string>();
  readonly tone = input<BadgeTone>('neutral');

  readonly classes = computed(() => `badge--${this.tone()}`);
}
