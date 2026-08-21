import { TestBed } from '@angular/core/testing';
import {
  DEFAULT_GENERATION_SETTINGS,
  GenerationSettingsService,
  isDefaultGenerationSettings,
  toRequestOptions,
  validateGenerationField
} from './generation-settings';

describe('validateGenerationField', () => {
  it('accepts values inside the supported range', () => {
    expect(validateGenerationField('temperature', '0.7')).toEqual({ ok: true, value: 0.7 });
    expect(validateGenerationField('topP', '1')).toEqual({ ok: true, value: 1 });
    expect(validateGenerationField('topK', '40')).toEqual({ ok: true, value: 40 });
    expect(validateGenerationField('repeatPenalty', '1.1')).toEqual({ ok: true, value: 1.1 });
    expect(validateGenerationField('maxTokens', '2048')).toEqual({ ok: true, value: 2048 });
  });

  it('accepts boundary values inclusive of min and max', () => {
    expect(validateGenerationField('temperature', '0').ok).toBe(true);
    expect(validateGenerationField('temperature', '2').ok).toBe(true);
    expect(validateGenerationField('topP', '0').ok).toBe(true);
    expect(validateGenerationField('repeatPenalty', '0.5').ok).toBe(true);
    expect(validateGenerationField('maxTokens', '1').ok).toBe(true);
    expect(validateGenerationField('maxTokens', '32768').ok).toBe(true);
  });

  it('rejects values outside the supported range with a range hint', () => {
    const tooHigh = validateGenerationField('temperature', '3');
    expect(tooHigh.ok).toBe(false);
    if (!tooHigh.ok) {
      expect(tooHigh.error).toContain('0–2');
    }

    const tooLow = validateGenerationField('repeatPenalty', '0.1');
    expect(tooLow.ok).toBe(false);
  });

  it('rejects non-numeric and blank input', () => {
    expect(validateGenerationField('temperature', '').ok).toBe(false);
    expect(validateGenerationField('temperature', '   ').ok).toBe(false);
    const junk = validateGenerationField('topP', 'abc');
    expect(junk.ok).toBe(false);
  });

  it('requires whole numbers for integer-only fields but allows fractional input to be rejected', () => {
    expect(validateGenerationField('maxTokens', '10.5').ok).toBe(false);
    expect(validateGenerationField('topK', '40.2').ok).toBe(false);
    // topP is not integer-only — fractions are fine.
    expect(validateGenerationField('topP', '0.95').ok).toBe(true);
  });
});

describe('toRequestOptions / defaults', () => {
  it('maps UI state onto LM Studio native parameter names', () => {
    const options = toRequestOptions({ ...DEFAULT_GENERATION_SETTINGS, reasoningMode: 'high' });
    expect(options).toEqual({
      temperature: 0.7,
      top_p: 1,
      top_k: 40,
      repeat_penalty: 1.1,
      max_tokens: 2048,
      reasoning_effort: 'high',
    });
  });

  it('omits reasoning_effort when the mode is off', () => {
    const options = toRequestOptions(DEFAULT_GENERATION_SETTINGS);
    expect(options.reasoning_effort).toBeUndefined();
    expect(Object.keys(options)).not.toContain('reasoning_effort');
  });

  it('recognises default state', () => {
    expect(isDefaultGenerationSettings(DEFAULT_GENERATION_SETTINGS)).toBe(true);
    expect(isDefaultGenerationSettings({ ...DEFAULT_GENERATION_SETTINGS, temperature: 1 })).toBe(false);
  });
});

describe('GenerationSettingsService', () => {
  let service: GenerationSettingsService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(GenerationSettingsService);
  });

  it('starts at the defaults and reports isDefault()', () => {
    expect(service.settings()).toEqual(DEFAULT_GENERATION_SETTINGS);
    expect(service.isDefault()).toBe(true);
  });

  it('applies partial updates', () => {
    service.update({ temperature: 1.2, topK: 0 });
    expect(service.settings().temperature).toBe(1.2);
    expect(service.settings().topK).toBe(0);
    // Untouched fields keep their values.
    expect(service.settings().maxTokens).toBe(DEFAULT_GENERATION_SETTINGS.maxTokens);
    expect(service.isDefault()).toBe(false);
  });

  it('reset() restores every default', () => {
    service.update({ temperature: 2, topP: 0.5, topK: 10, repeatPenalty: 1.5, maxTokens: 64, reasoningMode: 'low' });
    expect(service.isDefault()).toBe(false);

    service.reset();
    expect(service.settings()).toEqual(DEFAULT_GENERATION_SETTINGS);
    expect(service.isDefault()).toBe(true);
  });

  it('requestOptions() reflects the current state', () => {
    service.update({ reasoningMode: 'medium' });
    const options = service.requestOptions();
    expect(options.reasoning_effort).toBe('medium');
    expect(options.temperature).toBe(DEFAULT_GENERATION_SETTINGS.temperature);
  });
});
