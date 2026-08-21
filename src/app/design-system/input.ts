import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="field">
      @if (label()) {
        <span class="field-label">{{ label() }}</span>
      }
      <input
        class="field-control"
        [type]="type()"
        [value]="value()"
        [attr.step]="step() === '' ? null : step()"
        [attr.aria-label]="label()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        (input)="valueChange.emit($any($event.target).value)"
      />
      @if (hint()) {
        <span class="field-hint">{{ hint() }}</span>
      }
    </label>
  `,
  styleUrl: './form-fields.scss'
})
export class InputField {
  readonly label = input('');
  readonly type = input<'text' | 'search' | 'password' | 'number'>('text');
  /** Initial / externally-controlled value (one-way). */
  readonly value = input('');
  readonly placeholder = input('');
  readonly hint = input('');
  readonly disabled = input(false);
  /** Step for number inputs; empty string leaves the attribute off. */
  readonly step = input('');

  /** Emits the raw value on every input event (no built-in state). */
  readonly valueChange = output<string>();
}
