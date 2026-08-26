import { Component, computed, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-textarea',
  imports: [FormsModule],
  templateUrl: './textarea.component.html',
  styleUrl: './textarea.component.scss'
})
export class TextareaField {
  readonly label = input.required<string>();
  readonly placeholder = input('');
  readonly rows = input(3);
  /** Two-way value (signal model). */
  readonly value = model<string>('');
  readonly error = input<string | null>(null);
  readonly disabled = input(false);

  protected readonly describedBy = computed(() => {
    const ids: string[] = [];
    if (this.error() !== null) ids.push('lb-textarea-error');
    return ids.join(' ') || undefined;
  });
}
