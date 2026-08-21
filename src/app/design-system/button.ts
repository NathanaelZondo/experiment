import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

@Component({
  selector: 'app-button',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button [type]="type()" [class]="classes()" [attr.disabled]="disabled() || loading() ? true : null">
      @if (loading()) {
        <span class="btn-spinner" aria-hidden="true"></span>
      }
      <ng-content />
    </button>
  `,
  styleUrl: './button.scss'
})
export class Button {
  readonly variant = input<ButtonVariant>('primary');
  readonly size = input<'sm' | 'md'>('md');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly loading = input(false);

  readonly classes = computed(() => {
    const parts = ['btn', `btn--${this.variant()}`];
    if (this.size() === 'sm') {
      parts.push('btn--sm');
    }
    return parts.join(' ');
  });
}
