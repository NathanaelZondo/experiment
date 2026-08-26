import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-input',
  imports: [FormsModule],
  templateUrl: './input.component.html',
  styleUrl: './input.component.scss'
})
export class InputField {
  readonly label = input.required<string>();
  readonly type = input<'text' | 'url' | 'password' | 'number'>('text');
  readonly placeholder = input('');
  /** Two-way value (signal model). */
  readonly value = model<string>('');
  readonly error = input<string | null>(null);
  readonly hint = input<string | null>(null);
  readonly disabled = input(false);

  protected readonly describedBy = computed(() => {
    const ids: string[] = [];
    if (this.error() !== null) ids.push('lb-input-error');
    if (this.hint() !== null) ids.push('lb-input-hint');
    return ids.join(' ') || undefined;
  });
}
