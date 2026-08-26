/**
 * Settings store (in-memory only).
 *
 * Holds generation settings with validation against supported ranges, a
 * reset-to-defaults action, and the UI theme. The theme is held in RAM only —
 * refreshing the page returns to the default dark theme.
 */

import { Injectable, signal } from '@angular/core';
import type { GenerationSettings } from './types/lm-studio.types';

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  repeatPenalty: 1.1,
  maxOutputTokens: 2048,
  reasoningMode: 'auto'
};

/** Supported ranges for each numeric setting (inclusive bounds). */
export const SETTINGS_RANGES = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  topK: { min: 0, max: 100, integer: true },
  repeatPenalty: { min: 0.5, max: 2 },
  maxOutputTokens: { min: 1, max: 32768, integer: true }
} as const;

export type NumericSettingKey = keyof typeof SETTINGS_RANGES;

/** Validate a single numeric setting value against its supported range. */
export function validateNumericSetting(key: NumericSettingKey, raw: unknown): { ok: boolean; error?: string; value?: number } {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ok: false, error: 'Enter a number.' };
  }
  const range = SETTINGS_RANGES[key];
  if ((range as { integer?: boolean }).integer && !Number.isInteger(raw)) {
    return { ok: false, error: 'Must be a whole number.' };
  }
  if (raw < range.min || raw > range.max) {
    return { ok: false, error: `Must be between ${range.min} and ${range.max}.` };
  }
  return { ok: true, value: raw };
}

export type Theme = 'dark' | 'light';

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  readonly settings = signal<GenerationSettings>({ ...DEFAULT_GENERATION_SETTINGS });
  /** UI theme — held in RAM only (no persistence). */
  readonly theme = signal<Theme>('dark');

  /**
   * Apply one setting after range validation. Returns an error message when the
   * value is rejected; valid values are applied immediately.
   */
  setSetting(key: NumericSettingKey, raw: unknown): string | null {
    const result = validateNumericSetting(key, raw);
    if (!result.ok) return result.error ?? 'Invalid value.';
    this.settings.update((s) => ({ ...s, [key]: result.value as number }));
    return null;
  }

  setReasoningMode(mode: GenerationSettings['reasoningMode']): void {
    this.settings.update((s) => ({ ...s, reasoningMode: mode }));
  }

  /** Reset all generation settings to defaults. */
  resetToDefaults(): void {
    this.settings.set({ ...DEFAULT_GENERATION_SETTINGS });
  }

  toggleTheme(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }
}
