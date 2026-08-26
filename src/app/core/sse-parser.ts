/**
 * Server-Sent-Events stream parser for LM Studio chat responses.
 *
 * Handles both wire formats the application may encounter:
 *  - OpenAI-compatible chunks from POST /v1/chat/completions (stream: true):
 *      data: {"choices":[{"delta":{"content":"..."}}]}
 *      ...
 *      data: [DONE]
 *    with optional `usage` in the final chunk when stream_options.include_usage is set.
 *  - LM Studio native named events (event: chat.start / model loading & prompt
 *    processing / reasoning.delta / message.delta / error / chat.end).
 *
 * The parser is incremental (`feed()` per network chunk), tolerant of partial
 * lines, comments and malformed JSON (malformed events are counted and skipped
 * so a single bad frame cannot kill an otherwise good stream).
 */

import type { StreamEvent, UsageStats } from './types/lm-studio.types';

export interface SseParseOutcome {
  /** Events produced by this feed. */
  events: StreamEvent[];
  /** True once `data: [DONE]` (or a native chat.end) was seen. */
  done: boolean;
  /** Number of malformed data frames skipped so far. */
  malformedCount: number;
}

/** Defensive payload shape covering both OpenAI-compatible and native stream frames. */
interface StreamPayload {
  // OpenAI-compatible chunk fields
  choices?: Choice[];
  usage?: UsagePayload;
  error?: ErrorObject | string;
  // Native event fields (discriminator + text carriers)
  type?: string;
  content?: string;
  text?: string;
  message?: string;
  detail?: string;
  status?: string;
  delta?: DeltaPayload;
}

interface Choice {
  delta?: DeltaPayload;
  finish_reason?: string | null;
}

interface DeltaPayload {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
}

interface UsagePayload {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
}

interface ErrorObject {
  message?: string;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Extract text deltas from an OpenAI-style chunk payload. */
function openAiDelta(payload: StreamPayload): StreamEvent[] {
  const events: StreamEvent[] = [];
  for (const choice of payload.choices ?? []) {
    const delta = choice.delta;
    if (!delta) continue;
    const reasoning = asString(delta.reasoning_content) ?? asString(delta.reasoning);
    if (reasoning !== undefined) events.push({ kind: 'reasoningDelta', text: reasoning });
    const content = asString(delta.content);
    if (content !== undefined && content.length > 0) {
      events.push({ kind: 'messageDelta', text: content });
    }
  }
  return events;
}

/** Extract usage stats from an OpenAI-style chunk payload. */
function openAiUsage(payload: StreamPayload): UsageStats | undefined {
  const usage = payload.usage;
  if (!usage) return undefined;
  const stats: UsageStats = {};
  const promptTokens = asNumber(usage.prompt_tokens);
  const completionTokens = asNumber(usage.completion_tokens);
  const reasoningTokens = asNumber(usage.completion_tokens_details?.reasoning_tokens) ?? asNumber(usage.reasoning_tokens);
  if (promptTokens !== undefined) stats.promptTokens = promptTokens;
  if (completionTokens !== undefined) stats.completionTokens = completionTokens;
  if (reasoningTokens !== undefined) stats.reasoningTokens = reasoningTokens;
  return Object.keys(stats).length > 0 ? stats : undefined;
}

/** Map a native LM Studio event name + payload to normalized events. */
function nativeEvent(name: string, data: StreamPayload): StreamEvent[] {
  const text = asString(data.content) ?? asString(data.text);
  switch (name) {
    case 'chat.start':
      return [{ kind: 'start' }];
    case 'reasoning.delta':
      return text !== undefined ? [{ kind: 'reasoningDelta', text }] : [];
    case 'message.delta':
      return text !== undefined ? [{ kind: 'messageDelta', text }] : [];
    case 'error': {
      const message = asString(data.message) ?? (typeof data.error === 'string' ? data.error : undefined) ?? 'Stream error';
      return [{ kind: 'error', message }];
    }
    case 'chat.end': {
      let usage: UsageStats | undefined;
      if (data.usage !== undefined) {
        const u = data.usage;
        usage = {};
        const p = asNumber(u.prompt_tokens ?? u.input_tokens);
        const c = asNumber(u.completion_tokens ?? u.output_tokens);
        const r = asNumber(u.reasoning_tokens);
        if (p !== undefined) usage.promptTokens = p;
        if (c !== undefined) usage.completionTokens = c;
        if (r !== undefined) usage.reasoningTokens = r;
      }
      return [{ kind: 'end', usage, aggregatedContent: text }];
    }
    default: {
      // Model loading / prompt processing events carry human-readable detail.
      const detail = asString(data.message) ?? asString(data.detail) ?? asString(data.status);
      if (/load/i.test(name)) return [{ kind: 'modelLoading', detail }];
      if (/prompt|process/i.test(name)) return [{ kind: 'promptProcessing', detail }];
      // Unknown native event with a text payload: treat as message content.
      return text !== undefined ? [{ kind: 'messageDelta', text }] : [];
    }
  }
}

export class SseStreamParser {
  private buffer = '';
  private dataLines: string[] = [];
  private eventName: string | undefined;
  private lastUsage: UsageStats | undefined;
  private malformedCount = 0;
  done = false;

  /** Feed one network chunk; returns normalized events produced from it. */
  feed(chunk: string): SseParseOutcome {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    // The last element is either a complete empty tail or an incomplete line.
    this.buffer = lines.pop() ?? '';

    const events: StreamEvent[] = [];
    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line.length === 0) {
        events.push(...this.dispatch());
        continue;
      }
      this.consumeLine(line);
    }

    // If the buffer is empty, the chunk ended on a complete line boundary —
    // dispatch any remaining accumulated data (e.g. a final data: [DONE] line
    // that was not followed by a blank line in the `lines` array).
    if (this.buffer.length === 0) {
      events.push(...this.dispatch());
    }

    return { events, done: this.done, malformedCount: this.malformedCount };
  }

  /** Flush any trailing buffered line (stream ended without a final newline). */
  flush(): SseParseOutcome {
    const remaining = this.buffer;
    this.buffer = '';
    if (remaining.length === 0) {
      return { events: [], done: this.done, malformedCount: this.malformedCount };
    }
    this.consumeLine(remaining);
    const events = this.dispatch();
    return { events, done: this.done, malformedCount: this.malformedCount };
  }

  private consumeLine(line: string): void {
    if (line.length === 0 || line.startsWith(':')) return; // blank / comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    // Strip trailing CR for CRLF line-ending compatibility.
    if (value.endsWith('\r')) value = value.slice(0, -1);
    if (field === 'data') {
      this.dataLines.push(value);
    } else if (field === 'event') {
      this.eventName = value;
    }
    // Other fields (id, retry) are not needed.
  }

  /** Process the accumulated data lines as one SSE event. */
  private dispatch(): StreamEvent[] {
    const events: StreamEvent[] = [];
    if (this.dataLines.length === 0 && this.eventName === undefined) return events;
    const data = this.dataLines.join('\n');
    const name = this.eventName;
    this.dataLines = [];
    this.eventName = undefined;

    if (data.trim() === '[DONE]') {
      // OpenAI-compatible termination. Attach any usage captured earlier.
      events.push({ kind: 'end', usage: this.lastUsage });
      this.done = true;
      return events;
    }

    let payload: StreamPayload | undefined;
    try {
      const parsed: unknown = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null) {
        payload = parsed as StreamPayload;
      } else {
        this.malformedCount += 1;
        return events;
      }
    } catch {
      // Malformed frame: skip it but keep the stream alive.
      this.malformedCount += 1;
      return events;
    }

    if (name !== undefined && name.length > 0) {
      if (name === 'chat.end') this.done = true;
      events.push(...nativeEvent(name, payload));
      return events;
    }

    // No event name: OpenAI-compatible chunk (or unnamed native frame).
    const errorObj = typeof payload.error === 'object' && payload.error !== null ? payload.error : undefined;
    if (errorObj) {
      const message = asString(errorObj.message) ?? 'Stream error';
      events.push({ kind: 'error', message });
      return events;
    }

    // Native frames sometimes carry a `type` discriminator instead of an event name.
    const type = payload.type;
    if (type !== undefined && !Array.isArray(payload.choices)) {
      events.push(...nativeEvent(type, payload));
      return events;
    }

    const usage = openAiUsage(payload);
    if (usage !== undefined) this.lastUsage = usage;
    events.push(...openAiDelta(payload));
    // A chunk with finish_reason and no delta marks the end of generation.
    const finished = (payload.choices ?? []).some((c) => c.finish_reason != null);
    if (finished && events.length === 0) {
      events.push({ kind: 'end', usage: this.lastUsage });
      this.done = true;
    }
    return events;
  }
}
