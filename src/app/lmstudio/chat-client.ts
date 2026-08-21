import { LmStudioRequestError, classifyHttpError, classifyNetworkError } from './lm-studio-client';
import { normalizeBaseUrl } from './format';
import { SseParser } from './sse';
import { ChatCompletionResult, ChatMessage, ChatRequestOptions, ChatStats, ChatStreamEvent, ChatUsage } from './chat-types';

/** LM Studio's native (non-OpenAI) chat endpoint. */
const CHAT_PATH = '/api/v0/chat/completions';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Maps the OpenAI-style `usage` block (with LM Studio's reasoning extension). */
export function parseUsage(raw: unknown): ChatUsage | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const details = isRecord(raw['completion_tokens_details']) ? raw['completion_tokens_details'] : null;
  const usage: ChatUsage = {
    promptTokens: asNumber(raw['prompt_tokens']),
    completionTokens: asNumber(raw['completion_tokens']),
    totalTokens: asNumber(raw['total_tokens']),
    reasoningTokens: details === null ? undefined : asNumber(details['reasoning_tokens']),
  };
  return usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.totalTokens !== undefined
    ? usage
    : undefined;
}

/** Maps LM Studio's native `stats` block (times arrive in seconds). */
export function parseStats(raw: unknown): ChatStats | undefined {
  if (!isRecord(raw)) {
    return undefined;
  }
  const ttf = asNumber(raw['time_to_first_token']);
  const generation = asNumber(raw['generation_time']);
  const stats: ChatStats = {
    tokensPerSecond: asNumber(raw['tokens_per_second']),
    timeToFirstTokenMs: ttf !== undefined ? ttf * 1000 : undefined,
    generationTimeMs: generation !== undefined ? generation * 1000 : undefined,
    stopReason: asString(raw['stop_reason']),
  };
  return stats.tokensPerSecond !== undefined || stats.timeToFirstTokenMs !== undefined || stats.generationTimeMs !== undefined || stats.stopReason !== undefined
    ? stats
    : undefined;
}

/** Extracts the aggregated result from a non-streaming chat response body. */
export function parseChatCompletion(body: unknown): ChatCompletionResult {
  const record = isRecord(body) ? body : null;
  const rawChoices = record !== null && Array.isArray(record['choices']) ? (record['choices'] as unknown[]) : [];
  const firstChoice = rawChoices.length > 0 && isRecord(rawChoices[0]) ? rawChoices[0] : null;
  const message = firstChoice !== null && isRecord(firstChoice['message']) ? firstChoice['message'] : null;

  return {
    content: message !== null ? (asString(message['content']) ?? '') : '',
    reasoningContent: message === null ? undefined : asString(message['reasoning_content']),
    finishReason: firstChoice === null ? undefined : asString(firstChoice['finish_reason']),
    usage: isRecord(body) ? parseUsage(body['usage']) : undefined,
    stats: isRecord(body) ? parseStats(body['stats']) : undefined,
  };
}

/** Maps one streamed `chat.completion.chunk` into a stream event (or null for empty frames). */
export function parseChatChunk(raw: unknown): ChatStreamEvent | null {
  if (!isRecord(raw)) {
    return null;
  }
  // In-band error reported mid-stream.
  const inBandError = raw['error'];
  if (inBandError !== undefined) {
    const message = isRecord(inBandError) ? asString(inBandError['message']) ?? 'The model returned an error.' : String(inBandError);
    return { kind: 'error', message };
  }

  const choices = Array.isArray(raw['choices']) ? raw['choices'] : [];
  const firstChoice = choices.length > 0 && isRecord(choices[0]) ? choices[0] : null;
  const delta = firstChoice !== null && isRecord(firstChoice['delta']) ? firstChoice['delta'] : null;

  const contentDelta = delta === null ? undefined : asString(delta['content']);
  const reasoningDelta = delta === null ? undefined : asString(delta['reasoning_content']);
  const finishReason = firstChoice === null ? undefined : asString(firstChoice['finish_reason']);
  const usage = parseUsage(raw['usage']);
  const stats = parseStats(raw['stats']);

  if (contentDelta !== undefined || reasoningDelta !== undefined) {
    return {
      kind: 'delta',
      delta: {
        content: contentDelta,
        contentChanged: contentDelta !== undefined && contentDelta.length > 0,
        reasoningContent: reasoningDelta,
        reasoningChanged: reasoningDelta !== undefined && reasoningDelta.length > 0,
      },
    };
  }
  if (finishReason !== undefined || usage !== undefined || stats !== undefined) {
    return { kind: 'finish', finishReason, usage, stats };
  }
  return null; // A frame carrying neither content nor metadata — nothing to do.
}

/**
 * Typed client for LM Studio's native chat API (OpenAI-compatible wire format).
 * Pure class — no Angular, no storage: every call takes its configuration
 * explicitly so it is trivially testable with a mocked fetch.
 */
export class LmStudioChatClient {
  /** Non-streaming completion: POST /api/v0/chat/completions with stream:false. */
  async complete(
    baseUrl: string,
    modelId: string,
    messages: ChatMessage[],
    options?: ChatRequestOptions,
    apiToken?: string,
    signal?: AbortSignal
  ): Promise<ChatCompletionResult> {
    const body = await this.request(baseUrl, modelId, messages, false, options, apiToken, signal);
    return parseChatCompletion(body);
  }

  /**
   * Streaming completion: POST /api/v0/chat/completions with stream:true.
   * Reads the response body through a readable-stream SSE parser and invokes
   * `onEvent` for every parsed frame. Resolves when the stream ends (including
   * after an interrupted tail — partial results are already delivered).
   */
  async stream(
    baseUrl: string,
    modelId: string,
    messages: ChatMessage[],
    onEvent: (event: ChatStreamEvent) => void,
    options?: ChatRequestOptions,
    apiToken?: string,
    signal?: AbortSignal
  ): Promise<void> {
    const response = await this.fetchChat(baseUrl, modelId, messages, true, options, apiToken, signal);

    if (!response.body) {
      // No readable body (should not happen for stream:true) — degrade to a single parse.
      try {
        onEvent(parseChatChunk(await response.json()) ?? { kind: 'finish' });
      } catch {
        onEvent({ kind: 'error', message: 'The server returned an empty stream.' });
      }
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const parser = new SseParser();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        this.dispatchFrames(parser.push(decoder.decode(value, { stream: true })), onEvent);
      }
      // Recovery from an interrupted tail: flush a trailing frame that never
      // received its terminating blank line.
      this.dispatchFrames(parser.finish(), onEvent);
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // The stream was already closed (e.g. aborted) — nothing to release.
      }
    }
  }

  private dispatchFrames(frames: Array<{ value: string }>, onEvent: (event: ChatStreamEvent) => void): void {
    for (const frame of frames) {
      if (frame.value === '[DONE]') {
        continue; // Sentinel — the stream is complete.
      }
      let raw: unknown;
      try {
        raw = JSON.parse(frame.value);
      } catch {
        // Malformed or partial JSON line — skip it rather than crashing the run.
        continue;
      }
      const event = parseChatChunk(raw);
      if (event !== null) {
        onEvent(event);
      }
    }
  }

  private async request(
    baseUrl: string,
    modelId: string,
    messages: ChatMessage[],
    stream: boolean,
    options?: ChatRequestOptions,
    apiToken?: string,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.fetchChat(baseUrl, modelId, messages, stream, options, apiToken, signal);
    try {
      return (await response.json()) as unknown;
    } catch {
      // A 2xx with a non-JSON body is treated as an empty result.
      return undefined;
    }
  }

  private async fetchChat(
    baseUrl: string,
    modelId: string,
    messages: ChatMessage[],
    stream: boolean,
    options?: ChatRequestOptions,
    apiToken?: string,
    signal?: AbortSignal
  ): Promise<Response> {
    const headers = new Headers();
    headers.set('Accept', stream ? 'text/event-stream' : 'application/json');
    if (apiToken && apiToken.trim() !== '') {
      headers.set('Authorization', `Bearer ${apiToken.trim()}`);
    }

    // Sampling parameters are merged in only when defined, so a request with no
    // options keeps the exact wire shape it always had.
    const payload: Record<string, unknown> = { model: modelId, messages, stream };
    if (options !== undefined) {
      for (const [key, value] of Object.entries(options)) {
        if (value !== undefined) {
          payload[key] = value;
        }
      }
    }

    let response: Response;
    try {
      response = await fetch(`${normalizeBaseUrl(baseUrl)}${CHAT_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      throw new LmStudioRequestError(classifyNetworkError(error, baseUrl), error);
    }

    if (!response.ok) {
      throw new LmStudioRequestError(classifyHttpError(response.status, baseUrl));
    }
    return response;
  }
}
