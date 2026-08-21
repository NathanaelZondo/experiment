import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-icon-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="icon-btn" [attr.aria-label]="label()" [attr.disabled]="disabled() ? true : null">
      <ng-content />
    </button>
  `,
  styleUrl: './icon-button.scss'
})
export class IconButton {
  readonly label = input.required<string>();
  readonly disabled = input(false);
}
