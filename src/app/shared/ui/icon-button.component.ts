import { Component, input } from '@angular/core';

@Component({
  selector: 'app-icon-button',
  templateUrl: './icon-button.component.html',
  styleUrl: './icon-button.component.scss'
})
export class IconButton {
  /** Accessible name — required (icons carry no visible text). */
  readonly label = input.required<string>();
  readonly size = input<'sm' | 'md'>('md');
  readonly disabled = input(false);
}
