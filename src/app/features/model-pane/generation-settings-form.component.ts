import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SettingsStore, validateNumericSetting, type NumericSettingKey } from '../../core/settings.store';
import type { GenerationSettings } from '../../core/types/lm-studio.types';
import { Button } from '../../shared/ui/button.component';

/**
 * Generation settings with validation against supported ranges. Values are
 * applied live when valid; invalid input shows a per-field error and keeps the
 * last valid value in effect. "Reset to defaults" restores every setting.
 */
@Component({
  selector: 'app-generation-settings-form',
  imports: [FormsModule, Button],
  templateUrl: './generation-settings-form.component.html',
  styleUrl: './generation-settings-form.component.scss'
})
export class GenerationSettingsForm {
  private readonly store = inject(SettingsStore);

  /** Local text buffers (strings) so users can type freely while validating. */
  protected readonly temperatureValue = signal(String(this.store.settings().temperature));
  protected readonly topPValue = signal(String(this.store.settings().topP));
  protected readonly topKValue = signal(String(this.store.settings().topK));
  protected readonly repeatPenaltyValue = signal(String(this.store.settings().repeatPenalty));
  protected readonly maxOutputTokensValue = signal(String(this.store.settings().maxOutputTokens));

  protected readonly errors = signal<Partial<Record<NumericSettingKey, string>>>({});
  /** Reactive settings source for the reasoning-mode select. */
  protected readonly settingsSignal = this.store.settings;

  /** Dirty flag: any local buffer differs from the store value. */
  protected readonly isDirty = computed(() => {
    const s = this.store.settings();
    return (
      this.temperatureValue() !== String(s.temperature) ||
      this.topPValue() !== String(s.topP) ||
      this.topKValue() !== String(s.topK) ||
      this.repeatPenaltyValue() !== String(s.repeatPenalty) ||
      this.maxOutputTokensValue() !== String(s.maxOutputTokens)
    );
  });

  /** Validate + apply one numeric field from its text buffer. */
  protected updateField(key: NumericSettingKey, rawText: string): void {
    const parsed = Number(rawText);
    const result = validateNumericSetting(key, rawText.trim() === '' ? NaN : parsed);
    this.errors.update((e) => ({ ...e, [key]: result.ok ? undefined : (result.error ?? 'Invalid value.') }));
    if (result.ok && result.value !== undefined) {
      this.store.setSetting(key, result.value);
    }
  }

  protected onReasoningChange(mode: GenerationSettings['reasoningMode']): void {
    this.store.setReasoningMode(mode);
  }

  resetToDefaults(): void {
    this.store.resetToDefaults();
    const next = this.store.settings();
    this.temperatureValue.set(String(next.temperature));
    this.topPValue.set(String(next.topP));
    this.topKValue.set(String(next.topK));
    this.repeatPenaltyValue.set(String(next.repeatPenalty));
    this.maxOutputTokensValue.set(String(next.maxOutputTokens));
    this.errors.set({});
  }
}
