import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * CSS-driven tooltip: appears on hover AND keyboard focus of the trigger.
 * Wrap a single focusable element (button, icon button) in <app-tooltip>.
 */
@Component({
  selector: 'app-tooltip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="tooltip">
      <ng-content />
      <span class="tooltip-bubble" role="tooltip">{{ text }}</span>
    </span>
  `,
  styleUrl: './tooltip.scss'
})
export class Tooltip {
  /** The tooltip message. */
  text = '';
}
