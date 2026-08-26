/**
 * Typed LM Studio client.
 *
 * Endpoint map (fixed by the specification):
 *  - Discovery:        GET  {base}/api/v1/models          (native)
 *  - Load model:       POST {base}/api/v1/models/load     (native)
 *  - Unload model:     POST {base}/api/v1/models/unload   (native)
 *  - Chat generation:  POST {base}/v1/chat/completions    (OpenAI-compatible, streamed SSE)
 *
 * The legacy `/api/v0/*` endpoints are never used. The optional API token is
 * attached only as an Authorization header at request time and is never part
 * of any error message, log line or returned value.
 */

import { Injectable } from '@angular/core';
import { environment } from './environment';
import { httpError, LmApiError, toLmApiError } from './api-error';
import { SseStreamParser } from './sse-parser';
import type {
  CatalogModel,
  ChatMessageDto,
  ChatRequestOptions,
  GenerationSettings,
  LoadModelResponse,
  NativeModelEntry,
  NativeModelListResponse,
  StreamEvent
} from './types/lm-studio.types';

export interface ClientConfig {
  baseUrl: string;
  /** Optional LM Studio API token. Never logged or returned. */
  apiToken?: string;
}

/** Non-streaming OpenAI-compatible chat response (fallback when no body stream). */
interface NonStreamChatResponse {
  choices?: { message?: { content?: string; reasoning_content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Defensive shape of an error JSON body. */
interface ErrorBody {
  error?: { message?: string };
  message?: string;
}

/** OpenAI-compatible chat completion request body (store:false per spec). */
interface ChatCompletionRequest {
  model: string;
  messages: ChatMessageDto[];
  stream: boolean;
  store: false;
  temperature: number;
  top_p: number;
  top_k: number;
  repeat_penalty: number;
  max_tokens: number;
  stream_options: { include_usage: true };
  reasoning?: string;
  /** OpenAI-style thinking-effort control — accepted by LM Studio and shortens thinking. */
  reasoning_effort?: string;
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/** Build request headers without ever exposing the token value. */
function buildHeaders(config: ClientConfig, jsonBody: boolean): HeadersInit {
  const headers = new Headers();
  if (jsonBody) headers.set('Content-Type', 'application/json');
  if (config.apiToken && config.apiToken.trim().length > 0) {
    headers.set('Authorization', `Bearer ${config.apiToken.trim()}`);
  }
  return headers;
}

/* ------------------------- model catalogue normalization ------------------ */

function prettifyId(id: string): string {
  const tail = id.split('/').pop() ?? id;
  return tail.replace(/[_-]+/g, ' ').trim();
}

/** Extract a parameter count like "8B" from a model name when the API does not report one. */
function paramsFromName(name: string): string | undefined {
  const match = name.match(/\b(\d{1,3}(?:\.\d+)?)\s*b\b/i);
  return match ? `${match[1]}B` : undefined;
}

/** Extract a quantization tag like "q4_k_m" from a model id/name. */
function quantFromName(name: string): string | undefined {
  // Split on non-word characters (\W = [^a-zA-Z0-9_]) — preserves underscores within tokens.
  const tokens = name.split(/\W+/);
  for (const token of tokens) {
    if (/^[iq]\d{1,3}(_[a-z0-9]+)*$/i.test(token)) return token.toLowerCase();
  }
  return undefined;
}

function formatFromName(name: string): string | undefined {
  if (/gguf/i.test(name)) return 'GGUF';
  if (/safetensors|\.pt\b|pytorch/i.test(name)) return 'Safetensors';
  return undefined;
}

/** Optional non-blank string reader for defensively-shaped fields. */
function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Normalize the capabilities field into display strings.
 * Current contract: an object of flags ({ vision, trained_for_tool_use, reasoning });
 * legacy: an array of strings.
 */
function normalizeCapabilities(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((c): c is string => typeof c === 'string');
  }
  if (typeof raw === 'object' && raw !== null) {
    const flags = raw as Record<string, unknown>;
    const caps: string[] = [];
    if (flags['vision']) caps.push('vision');
    if (flags['trained_for_tool_use']) caps.push('tool use');
    if (flags['reasoning']) caps.push('reasoning');
    return caps;
  }
  return [];
}

/** Consistent human-readable format label. */
function normalizeFormat(entry: NativeModelEntry, id: string, nameSource: string): string | undefined {
  const raw = asOptionalString(entry.format);
  if (raw) {
    if (/gguf/i.test(raw)) return 'GGUF';
    if (/safetensors/i.test(raw)) return 'Safetensors';
    return raw;
  }
  if (typeof entry.type === 'string' && /gguf|safetensors/i.test(entry.type)) {
    return /gguf/i.test(entry.type) ? 'GGUF' : 'Safetensors';
  }
  return formatFromName(`${id} ${nameSource}`);
}

/**
 * Normalize one native model entry into the catalogue shape (defensive).
 *
 * Supports the current LM Studio contract (`key`, `display_name`, `publisher`,
 * `size_bytes`, `quantization.name`, `params_string`, `loaded_instances`,
 * object-valued `capabilities`, `type`) as well as the legacy variant
 * (`id`, `name`, `owned_by`, `size`, boolean `loaded`).
 */
export function normalizeModelEntry(entry: NativeModelEntry, loadedId?: string): CatalogModel {
  const id =
    asOptionalString(entry.id) ??
    asOptionalString(entry.key) ??
    asOptionalString(entry.name) ??
    JSON.stringify(entry);
  const nameSource = asOptionalString(entry.display_name) ?? asOptionalString(entry.name) ?? id;

  const capabilities = normalizeCapabilities(entry.capabilities);

  // Chat capability: an explicit model `type` wins, then capability data, then
  // assume usable (typical local LLM).
  let chatCapable: boolean;
  const typeHint = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
  if (/embed|image|audio|tts|stt|whisper|rerank/i.test(typeHint)) {
    chatCapable = false;
  } else if (/llm|chat|text[-_ ]?(gen|generation)/i.test(typeHint)) {
    chatCapable = true;
  } else if (capabilities.length > 0) {
    chatCapable = capabilities.some((c) => /chat|text[-_ ]?gen/i.test(c));
  } else {
    chatCapable = true;
  }

  // Quantization: `{ name }` object (current) or string (legacy), else derive.
  const quantRaw = entry.quantization;
  const quantization =
    (typeof quantRaw === 'string' ? asOptionalString(quantRaw) : undefined) ??
    (quantRaw && typeof quantRaw === 'object' ? asOptionalString(quantRaw.name) : undefined) ??
    quantFromName(`${id} ${nameSource}`);

  // Parameter count: `params_string` (current) → legacy `architecture.parameters`
  // object → name heuristic.
  const architecture = entry.architecture;
  const archParams = architecture && typeof architecture === 'object' ? architecture.parameters : undefined;
  const parameterCount =
    asOptionalString(entry.params_string) ??
    (typeof archParams === 'string'
      ? asOptionalString(archParams)
      : typeof archParams === 'number' && Number.isFinite(archParams)
        ? String(archParams)
        : undefined) ??
    paramsFromName(`${id} ${nameSource}`);

  // Size: `size_bytes` (current) or `size` (legacy).
  const sizeBytes =
    typeof entry.size_bytes === 'number' && Number.isFinite(entry.size_bytes)
      ? entry.size_bytes
      : typeof entry.size === 'number' && Number.isFinite(entry.size)
        ? entry.size
        : undefined;

  // Loaded state: `loaded_instances` (current) or booleans / top-level id (legacy).
  const instances = Array.isArray(entry.loaded_instances) ? entry.loaded_instances : undefined;
  const loaded =
    instances !== undefined
      ? instances.length > 0
      : Boolean(entry.loaded ?? entry.is_loaded ?? (loadedId !== undefined && id === loadedId));
  const instanceId = instances && instances.length > 0 ? asOptionalString(instances[0]?.id) : undefined;

  return {
    id,
    name: prettifyId(nameSource),
    publisher: asOptionalString(entry.publisher) ?? asOptionalString(entry.owned_by),
    quantization,
    parameterCount,
    sizeBytes,
    format: normalizeFormat(entry, id, nameSource),
    capabilities,
    chatCapable,
    loaded,
    instanceId
  };
}

/* --------------------------------- client ---------------------------------- */

@Injectable({ providedIn: 'root' })
export class LmStudioClient {
  /** Connection test + model discovery via the native API. */
  async listModels(config: ClientConfig): Promise<CatalogModel[]> {
    const base = normalizeBaseUrl(config.baseUrl || environment.lmStudioUrl);
    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/models`, { headers: buildHeaders(config, false) });
    } catch (err) {
      throw toLmApiError(err);
    }
    if (!response.ok) {
      throw httpError(response.status, await safeBodyExcerpt(response));
    }
    let payload: NativeModelListResponse;
    try {
      payload = (await response.json()) as NativeModelListResponse;
    } catch {
      throw new LmApiError('Model list response was not valid JSON', 'parse');
    }
    const raw = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
    return raw.map((entry) => normalizeModelEntry(entry, typeof payload.loaded_model_id === 'string' ? payload.loaded_model_id : undefined));
  }

  /**
   * Load a model (native API). Exactly one model may be loaded at a time.
   * Returns the parsed response — it carries the running instance identifier
   * (`instance_id`) used for unload requests and benchmark metrics.
   */
  async loadModel(config: ClientConfig, modelId: string): Promise<LoadModelResponse | undefined> {
    const base = normalizeBaseUrl(config.baseUrl || environment.lmStudioUrl);
    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/models/load`, {
        method: 'POST',
        headers: buildHeaders(config, true),
        body: JSON.stringify({ model: modelId })
      });
    } catch (err) {
      throw toLmApiError(err);
    }
    if (!response.ok) {
      throw httpError(response.status, await safeBodyExcerpt(response));
    }
    try {
      const text = await response.text();
      if (text.trim().length === 0) return undefined;
      const parsed: unknown = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null ? (parsed as LoadModelResponse) : undefined;
    } catch {
      return undefined; // 200 with an empty/non-JSON body — nothing to report.
    }
  }

  /**
   * Unload a model (native API). Current LM Studio servers require the running
   * instance identifier in the body (`{ instance_id }`); older servers accepted
   * an empty body, so we fall back to `{}` when no instance id is known.
   */
  async unloadModel(config: ClientConfig, instanceId?: string): Promise<void> {
    const base = normalizeBaseUrl(config.baseUrl || environment.lmStudioUrl);
    let response: Response;
    try {
      response = await fetch(`${base}/api/v1/models/unload`, {
        method: 'POST',
        headers: buildHeaders(config, true),
        body: JSON.stringify(instanceId ? { instance_id: instanceId } : {})
      });
    } catch (err) {
      throw toLmApiError(err);
    }
    if (!response.ok) {
      throw httpError(response.status, await safeBodyExcerpt(response));
    }
  }

  /**
   * Stream a chat completion from the OpenAI-compatible endpoint.
   *
   * Sends the complete in-memory conversation history with `store: false` and
   * yields normalized stream events until `data: [DONE]`. Cancellation is
   * propagated through the provided AbortSignal; an aborted read surfaces as an
   * LmApiError of kind 'aborted' so callers can keep partial content.
   */
  async *chatStream(config: ClientConfig, options: ChatRequestOptions): AsyncGenerator<StreamEvent> {
    const base = normalizeBaseUrl(config.baseUrl || environment.lmStudioUrl);

    const body: ChatCompletionRequest = {
      model: options.modelId,
      messages: options.messages,
      stream: true,
      store: false,
      temperature: options.settings.temperature,
      top_p: options.settings.topP,
      top_k: options.settings.topK,
      repeat_penalty: options.settings.repeatPenalty,
      max_tokens: options.settings.maxOutputTokens,
      stream_options: { include_usage: true }
    };
    if (options.settings.reasoningMode !== 'auto') {
      // `reasoning` is the legacy knob; LM Studio honours `reasoning_effort`
      // (minimal/low/medium/high) for effort control, so send both. Note that
      // even "minimal" cannot fully disable thinking on reasoning models — the
      // settings UI explains this to the user.
      body.reasoning = options.settings.reasoningMode === 'enabled' ? 'required' : 'off';
      body.reasoning_effort = options.settings.reasoningMode === 'enabled' ? 'high' : 'minimal';
    }

    let response: Response;
    try {
      response = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(config, true),
        body: JSON.stringify(body),
        signal: options.signal
      });
    } catch (err) {
      throw toLmApiError(err);
    }

    if (!response.ok) {
      throw httpError(response.status, await safeBodyExcerpt(response));
    }
    if (!response.body) {
      // Non-streaming fallback: parse a single JSON completion.
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new LmApiError('Chat response was not valid JSON', 'parse');
      }
      const rec = (typeof payload === 'object' && payload !== null ? payload : {}) as NonStreamChatResponse;
      const first = Array.isArray(rec.choices) ? rec.choices[0] : undefined;
      if (first?.message?.content !== undefined) {
        yield { kind: 'start' };
        if (typeof first.message.reasoning_content === 'string') {
          yield { kind: 'reasoningDelta', text: first.message.reasoning_content };
        }
        yield { kind: 'messageDelta', text: first.message.content };
      }
      const usage = rec.usage;
      yield {
        kind: 'end',
        usage:
          usage && (usage.prompt_tokens !== undefined || usage.completion_tokens !== undefined)
            ? {
                promptTokens: usage.prompt_tokens,
                completionTokens: usage.completion_tokens
              }
            : undefined
      };
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parser = new SseStreamParser();
    const signal = options.signal;

    try {
      for (;;) {
        let read: ReadableStreamReadResult<Uint8Array>;
        try {
          // Race the read against the abort signal so cancellation unblocks the loop.
          read = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            const onAbort = () => {
              // Cancel the underlying stream reader so pending reads unblock.
              reader.cancel(new DOMException('Aborted', 'AbortError')).catch(() => {});
              cleanup();
              reject(new DOMException('Aborted', 'AbortError'));
            };
            const cleanup = () => signal?.removeEventListener('abort', onAbort);
            signal?.addEventListener('abort', onAbort, { once: true });
            reader.read().then(resolve, reject);
          });
        } catch (err) {
          throw toLmApiError(err);
        }
        if (read.done) break;
        const outcome = parser.feed(decoder.decode(read.value, { stream: true }));
        for (const event of outcome.events) yield event;
        if (parser.done) break;
      }
      const tail = decoder.decode();
      if (tail.length > 0) {
        const outcome = parser.feed(tail);
        for (const event of outcome.events) yield event;
      }
      const flushed = parser.flush();
      for (const event of flushed.events) yield event;
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Already released — nothing to do.
      }
    }
  }
}

/** Short, safe excerpt of an error body (never includes headers or credentials). */
async function safeBodyExcerpt(response: Response): Promise<string | undefined> {
  try {
    const text = await response.text();
    if (!text) return undefined;
    let message: string | undefined;
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed === 'object' && parsed !== null) {
        const rec = parsed as ErrorBody;
        message = rec.error?.message ?? rec.message;
      } else if (typeof parsed === 'string') {
        message = parsed;
      }
    } catch {
      message = text;
    }
    const clean = (message ?? text).replace(/\s+/g, ' ').trim();
    return clean.length > 0 ? clean.slice(0, 160) : undefined;
  } catch {
    return undefined;
  }
}

/** Re-export for callers that only need the settings type. */
export type { GenerationSettings };
