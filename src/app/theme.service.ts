import { Injectable, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

/**
 * Holds the active theme in RAM only. The initial value follows the
 * OS preference; nothing is persisted to localStorage or anywhere else,
 * so refreshing the page resets the choice.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this.initialTheme());

  toggle(): void {
    this.theme.update((t) => (t === 'light' ? 'dark' : 'light'));
  }

  set(theme: Theme): void {
    this.theme.set(theme);
  }

  private initialTheme(): Theme {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
    ) {
      return 'dark';
    }
    return 'light';
  }
}
