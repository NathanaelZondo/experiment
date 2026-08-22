import { Injectable, signal } from '@angular/core';

export type ThemeMode = 'light' | 'dark';

// Export the signal for direct use in templates if needed
export const themeSignal = signal<ThemeMode>('light');

@Injectable({ providedIn: 'root' })
export class ThemeService {
  /** Current theme mode - held in RAM only */
  protected readonly _theme = signal<ThemeMode>('light');

  /** Get current theme value */
  public getValue(): ThemeMode {
    return this._theme();
  }

  /** Toggle between light and dark */
  public toggle(): void {
    const next = this._theme() === 'light' ? 'dark' : 'light';
    this._theme.set(next);
    // Update HTML class for CSS custom properties
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  /** Set theme explicitly (RAM only, no persistence) */
  public setTheme(mode: ThemeMode): void {
    this._theme.set(mode);
    if (mode === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }

  /** The internal signal - accessible for injection */
  public readonly theme = this._theme.asReadonly();
}