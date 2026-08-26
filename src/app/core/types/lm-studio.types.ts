/**
 * Typed API contracts for LocalBench Chat.
 *
 * Two families of endpoints are used against LM Studio:
 *  - Native management API (discovery / load / unload): `/api/v1/models`,
 *    `/api/v1/models/load`, `/api/v1/models/unload`.
 *  - OpenAI-compatible chat endpoint for generation: `POST /v1/chat/completions`
 *    with streamed SSE (`data:` events, terminated by `data: [DONE]`).
 *
 * The native model listing is parsed defensively because field availability
 * varies between LM Studio versions; missing fields degrade to "unknown" in the UI.
 */

/* ---------------------------------- chat --------------------------------- */

export type ChatRole = 'system' | 'user' | 'assistant';

/** Wire-format message sent to /v1/chat/completions (OpenAI-compatible). */
export interface ChatMessageDto {
  role: ChatRole;
  content: string;
}

export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'failed' | 'cancelled';

/** Per-response benchmark metrics. Optional fields are shown as "—" when the server does not report them. */
export interface ResponseMetrics {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  tokensPerSecond?: number;
  /** Milliseconds from request start to first content delta. */
  timeToFirstTokenMs?: number;
  totalElapsedMs: number;
  /** Measured client-side when the model was loaded during this session. */
  modelLoadTimeMs?: number;
  /** Model instance identifier when exposed by the server. */
  instanceId?: string;
}

/** A single message in a conversation (in-memory only). */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  /** Reasoning/thinking text supplied by the model, when present. */
  reasoning?: string;
  status: MessageStatus;
  createdAt: number;
  /** Model that produced this message (assistant messages). */
  modelId?: string;
  /** Human-readable failure reason for failed/cancelled messages. */
  error?: string;
  metrics?: ResponseMetrics;
}

/** A conversation held entirely in RAM. */
export interface Conversation {
  id: string;
  title: string;
  systemPrompt: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

/* ------------------------------ model catalogue --------------------------- */

/** Normalized model entry for the catalogue UI. */
export interface CatalogModel {
  id: string;
  name: string;
  publisher?: string;
  quantization?: string;
  parameterCount?: string;
  sizeBytes?: number;
  format?: string;
  capabilities: string[];
  /** True when the model can be used for chat generation. */
  chatCapable: boolean;
  /** True when this is the currently loaded model. */
  loaded: boolean;
  /** Model instance identifier reported by the server, when the model is loaded. */
  instanceId?: string;
}

/**
 * Raw entry as returned by GET /api/v1/models (defensively typed).
 *
 * Current LM Studio servers report the live contract:
 *   { type, publisher, key, display_name, architecture, quantization, size_bytes,
 *     params_string, loaded_instances, format, capabilities, ... }
 * Older / alternative variants use `id` / `name` / `owned_by` / `size` /
 * `loaded` instead — both shapes are normalized.
 */
export interface NativeModelEntry {
  id?: string;
  /** Current contract: the model identifier (e.g. "qwen/qwen3.8-27b"). */
  key?: string;
  name?: string;
  /** Current contract: human-readable name. */
  display_name?: string;
  object?: string;
  owned_by?: string;
  publisher?: string;
  size?: number;
  /** Current contract: model size in bytes. */
  size_bytes?: number;
  type?: string;
  format?: string;
  /** Current contract: `{ name, bits_per_weight }` object (nullable); legacy: string. */
  quantization?: string | { name?: string; bits_per_weight?: number } | null;
  /** Current contract: architecture name string; legacy: object with `parameters`. */
  architecture?: string | { parameters?: string | number; [key: string]: unknown };
  /** Current contract: parameter count like "27B" or "35B-A3B" (nullable). */
  params_string?: string | null;
  /** Current contract: capability flags object; legacy: string array. */
  capabilities?: string[] | Record<string, unknown> | null;
  loaded?: boolean;
  is_loaded?: boolean;
  /** Current contract: loaded instances (non-empty ⇒ the model is loaded). */
  loaded_instances?: Array<{ id?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** Response envelope of GET /api/v1/models. */
export interface NativeModelListResponse {
  data?: NativeModelEntry[];
  models?: NativeModelEntry[];
  /** Some versions report the loaded model id at top level. */
  loaded_model_id?: string;
  [key: string]: unknown;
}

/** Response of POST /api/v1/models/load (defensively typed). */
export interface LoadModelResponse {
  type?: string;
  /** Identifier of the running instance (used for unload + benchmark metrics). */
  instance_id?: string;
  load_time_seconds?: number;
  status?: string;
  [key: string]: unknown;
}

/** Response of POST /api/v1/models/unload (defensively typed). */
export interface UnloadModelResponse {
  instance_id?: string;
  [key: string]: unknown;
}

/* ------------------------------- connection ------------------------------- */

export type ConnectionStatus = 'disconnected' | 'checking' | 'connected' | 'failed';

/** Result of a connection test (GET /api/v1/models). */
export interface ConnectionResult {
  ok: boolean;
  status: Extract<ConnectionStatus, 'connected' | 'failed'>;
  models?: CatalogModel[];
  error?: string;
}

/* ------------------------------ generation -------------------------------- */

/** Generation settings exposed in the model pane (validated against supported ranges). */
export interface GenerationSettings {
  /** 0..2 */
  temperature: number;
  /** 0..1 */
  topP: number;
  /** integer 0..100 */
  topK: number;
  /** 0.5..2 */
  repeatPenalty: number;
  /** 1..32768 */
  maxOutputTokens: number;
  reasoningMode: 'auto' | 'enabled' | 'disabled';
}

/** Token usage as reported by the OpenAI-compatible endpoint (stream_options.include_usage). */
export interface UsageStats {
  promptTokens?: number;
  completionTokens?: number;
  /** Reasoning tokens when the server reports them. */
  reasoningTokens?: number;
}

/* ------------------------------ stream events ----------------------------- */

/**
 * Normalized SSE event from a chat stream. The parser accepts both the
 * OpenAI-compatible `data:` chunk format (used by /v1/chat/completions) and
 * LM Studio's native named events (chat.start, model loading / prompt
 * processing, reasoning.delta, message.delta, error, chat.end).
 */
export type StreamEvent =
  | { kind: 'start' }
  | { kind: 'modelLoading'; detail?: string }
  | { kind: 'promptProcessing'; detail?: string }
  | { kind: 'reasoningDelta'; text: string }
  | { kind: 'messageDelta'; text: string }
  | { kind: 'error'; message: string }
  | { kind: 'end'; usage?: UsageStats; aggregatedContent?: string };

/** Options for a chat generation request. */
export interface ChatRequestOptions {
  modelId: string;
  /** Complete in-memory conversation history (system prompt included). */
  messages: ChatMessageDto[];
  settings: GenerationSettings;
  signal?: AbortSignal;
}
