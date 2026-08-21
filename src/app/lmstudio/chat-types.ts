/** A single chat message as sent to LM Studio's /api/v0/chat/completions endpoint. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Sampling and decoding parameters for a chat request (LM Studio native names).
 * All keys are optional — only defined values are serialized into the body, so
 * models that ignore an unknown parameter simply receive it harmlessly.
 */
export interface ChatRequestOptions {
  temperature?: number;
  top_p?: number;
  /** Keep only the K most likely tokens; 0 disables the filter. */
  top_k?: number;
  repeat_penalty?: number;
  max_tokens?: number;
  /** Reasoning/thinking effort for models that support it. */
  reasoning_effort?: 'low' | 'medium' | 'high';
}

/** Token usage reported by the server (OpenAI-style, extended with reasoning tokens). */
export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** Reasoning/thinking tokens when the model supports them. */
  reasoningTokens?: number;
}

/** Performance statistics reported by LM Studio (native chat response extension). */
export interface ChatStats {
  tokensPerSecond?: number;
  timeToFirstTokenMs?: number;
  generationTimeMs?: number;
  stopReason?: string;
}

/** A delta of streamed content: either visible text or reasoning text. */
export interface ChatDelta {
  /** Incremental visible response text (may be empty). */
  content?: string;
  /** Incremental reasoning/thinking text (may be empty). */
  contentChanged: boolean;
  reasoningContent?: string;
  reasoningChanged: boolean;
}

/** One parsed SSE frame from the chat stream. */
export type ChatStreamEvent =
  | { kind: 'delta'; delta: ChatDelta }
  /** The final chunk carrying finish_reason and/or aggregated stats. */
  | { kind: 'finish'; finishReason?: string; usage?: ChatUsage; stats?: ChatStats }
  /** An in-band error reported by the server mid-stream. */
  | { kind: 'error'; message: string };

/** The fully parsed result of a non-streaming chat completion. */
export interface ChatCompletionResult {
  content: string;
  reasoningContent?: string;
  finishReason?: string;
  usage?: ChatUsage;
  stats?: ChatStats;
}
