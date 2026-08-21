import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-textarea',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="field">
      @if (label()) {
        <span class="field-label">{{ label() }}</span>
      }
      <textarea
        class="field-control field-textarea"
        [value]="value()"
        [attr.aria-label]="label()"
        [placeholder]="placeholder()"
        [disabled]="disabled()"
        [rows]="rows()"
        (input)="valueChange.emit($any($event.target).value)"
      ></textarea>
      @if (hint()) {
        <span class="field-hint">{{ hint() }}</span>
      }
    </label>
  `,
  styleUrl: './form-fields.scss'
})
export class TextareaField {
  readonly label = input('');
  /** Initial / externally-controlled value (one-way). */
  readonly value = input('');
  readonly placeholder = input('');
  readonly hint = input('');
  readonly disabled = input(false);
  readonly rows = input(4);

  /** Emits the raw value on every input event (no built-in state). */
  readonly valueChange = output<string>();
}
