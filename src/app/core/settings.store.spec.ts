import { DEFAULT_GENERATION_SETTINGS, SettingsStore, validateNumericSetting } from './settings.store';

describe('validateNumericSetting', () => {
  it('accepts values inside the supported range', () => {
    expect(validateNumericSetting('temperature', 0.7)).toEqual({ ok: true, value: 0.7 });
    expect(validateNumericSetting('topP', 1).ok).toBe(true);
    expect(validateNumericSetting('topK', 0).ok).toBe(true);
    expect(validateNumericSetting('repeatPenalty', 2).ok).toBe(true);
    expect(validateNumericSetting('maxOutputTokens', 32768).ok).toBe(true);
  });

  it('rejects out-of-range values with a range message', () => {
    const tooHigh = validateNumericSetting('temperature', 2.5);
    expect(tooHigh.ok).toBe(false);
    expect(tooHigh.error).toContain('between');
    const tooLow = validateNumericSetting('repeatPenalty', 0.1);
    expect(tooLow.ok).toBe(false);
  });

  it('rejects non-numeric input', () => {
    expect(validateNumericSetting('temperature', 'hot').ok).toBe(false);
    expect(validateNumericSetting('topK', NaN).ok).toBe(false);
    expect(validateNumericSetting('maxOutputTokens', null).ok).toBe(false);
  });

  it('enforces integer constraints for topK and maxOutputTokens', () => {
    expect(validateNumericSetting('topK', 40.5).ok).toBe(false);
    expect(validateNumericSetting('maxOutputTokens', 1024.9).ok).toBe(false);
    expect(validateNumericSetting('temperature', 0.75).ok).toBe(true); // fractional allowed here
  });
});

describe('SettingsStore', () => {
  let store: SettingsStore;

  beforeEach(() => {
    store = new SettingsStore();
  });

  it('starts with the documented defaults', () => {
    expect(store.settings()).toEqual(DEFAULT_GENERATION_SETTINGS);
    expect(store.theme()).toBe('dark');
  });

  it('applies valid settings and rejects invalid ones without changing state', () => {
    expect(store.setSetting('temperature', 1.2)).toBeNull();
    expect(store.settings().temperature).toBe(1.2);

    const error = store.setSetting('topP', 4);
    expect(error).toBeTruthy();
    expect(store.settings().topP).toBe(DEFAULT_GENERATION_SETTINGS.topP); // unchanged
  });

  it('updates the reasoning mode independently of numeric settings', () => {
    store.setReasoningMode('enabled');
    expect(store.settings().reasoningMode).toBe('enabled');
    expect(store.settings().temperature).toBe(DEFAULT_GENERATION_SETTINGS.temperature);
  });

  it('resetToDefaults restores every setting after changes', () => {
    store.setSetting('temperature', 1.9);
    store.setSetting('topK', 5);
    store.setReasoningMode('disabled');
    store.resetToDefaults();
    expect(store.settings()).toEqual(DEFAULT_GENERATION_SETTINGS);
  });

  it('toggles the theme between dark and light (RAM only)', () => {
    expect(store.theme()).toBe('dark');
    store.toggleTheme();
    expect(store.theme()).toBe('light');
    store.toggleTheme();
    expect(store.theme()).toBe('dark');
  });
});
