import { Injectable, signal } from '@angular/core';
import { ChatRequestOptions } from '../lmstudio/chat-types';

/** Reasoning effort levels accepted by LM Studio's native chat endpoint. */
export type ReasoningMode = 'off' | 'low' | 'medium' | 'high';

/** Sampling and decoding parameters sent with every chat request (Phase 8). */
export interface GenerationSettings {
  /** Randomness of the output, 0–2. */
  temperature: number;
  /** Nucleus sampling threshold, 0–1. */
  topP: number;
  /** Keep only the K most likely tokens; 0 disables the filter. */
  topK: number;
  /** Penalty applied to repeated tokens, 0.5–2 (1 = no penalty). */
  repeatPenalty: number;
  /** Maximum number of tokens in the response. */
  maxTokens: number;
  /** Reasoning/thinking effort; 'off' omits the parameter entirely. */
  reasoningMode: ReasoningMode;
}

/** Supported range per numeric field, used for validation and UI hints. */
export interface FieldRange {
  min: number;
  max: number;
  step: number;
  /** True when the value must be a whole number. */
  integerOnly?: boolean;
}

export const GENERATION_FIELD_RANGES: Record<Exclude<keyof GenerationSettings, 'reasoningMode'>, FieldRange> = {
  temperature: { min: 0, max: 2, step: 0.1 },
  topP: { min: 0, max: 1, step: 0.05 },
  topK: { min: 0, max: 256, step: 1, integerOnly: true },
  repeatPenalty: { min: 0.5, max: 2, step: 0.05 },
  maxTokens: { min: 1, max: 32768, step: 1, integerOnly: true },
};

export const REASONING_MODES: ReasoningMode[] = ['off', 'low', 'medium', 'high'];

/** App-level defaults; "Reset to defaults" restores exactly this state. */
export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  temperature: 0.7,
  topP: 1,
  topK: 40,
  repeatPenalty: 1.1,
  maxTokens: 2048,
  reasoningMode: 'off',
};

export type GenerationField = Exclude<keyof GenerationSettings, never>;

type FieldValidationResult = { ok: true; value: number } | { ok: false; error: string };

/** Validates one numeric field against its supported range. Pure — no state. */
export function validateGenerationField(field: Exclude<GenerationField, 'reasoningMode'>, raw: string): FieldValidationResult {
  const range = GENERATION_FIELD_RANGES[field];
  if (raw.trim() === '') {
    return { ok: false, error: `Enter a value between ${range.min} and ${range.max}.` };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return { ok: false, error: 'Enter a number.' };
  }
  if (range.integerOnly && !Number.isInteger(parsed)) {
    return { ok: false, error: `${field} must be a whole number.` };
  }
  if (parsed < range.min || parsed > range.max) {
    return { ok: false, error: `Supported range is ${range.min}–${range.max}.` };
  }
  return { ok: true, value: parsed };
}

/** True when the settings are exactly at their defaults. */
export function isDefaultGenerationSettings(settings: GenerationSettings): boolean {
  const d = DEFAULT_GENERATION_SETTINGS;
  return (
    settings.temperature === d.temperature &&
    settings.topP === d.topP &&
    settings.topK === d.topK &&
    settings.repeatPenalty === d.repeatPenalty &&
    settings.maxTokens === d.maxTokens &&
    settings.reasoningMode === d.reasoningMode
  );
}

/** Maps the UI state onto LM Studio's native request parameters. */
export function toRequestOptions(settings: GenerationSettings): ChatRequestOptions {
  const options: ChatRequestOptions = {
    temperature: settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    repeat_penalty: settings.repeatPenalty,
    max_tokens: settings.maxTokens,
  };
  if (settings.reasoningMode !== 'off') {
    options.reasoning_effort = settings.reasoningMode;
  }
  return options;
}

/**
 * Holds the app-wide generation parameters in RAM only — no persistence.
 * The UI validates input before calling `update`, so this service always
 * holds a valid state and can be read directly by ChatService.
 */
@Injectable({ providedIn: 'root' })
export class GenerationSettingsService {
  readonly settings = signal<GenerationSettings>({ ...DEFAULT_GENERATION_SETTINGS });

  /** Applies a validated patch (partial updates are fine). */
  update(patch: Partial<GenerationSettings>): void {
    this.settings.update((current) => ({ ...current, ...patch }));
  }

  /** Restores every parameter to its default. */
  reset(): void {
    this.settings.set({ ...DEFAULT_GENERATION_SETTINGS });
  }

  isDefault(): boolean {
    return isDefaultGenerationSettings(this.settings());
  }

  /** The parameters to merge into the next chat request body. */
  requestOptions(): ChatRequestOptions {
    return toRequestOptions(this.settings());
  }
}
