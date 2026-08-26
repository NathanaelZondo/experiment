import { SseStreamParser } from './sse-parser';
import type { StreamEvent } from './types/lm-studio.types';

/** Collect the kinds of events produced by feeding a full stream. */
function parseAll(chunks: string[]): { events: StreamEvent[]; done: boolean; malformedCount: number } {
  const parser = new SseStreamParser();
  let events: StreamEvent[] = [];
  for (const chunk of chunks) {
    const outcome = parser.feed(chunk);
    events.push(...outcome.events);
  }
  const flushed = parser.flush();
  events.push(...flushed.events);
  return { events, done: parser.done, malformedCount: flushed.malformedCount };
}

describe('SseStreamParser', () => {
  describe('OpenAI-compatible data: chunks (POST /v1/chat/completions)', () => {
    it('parses content deltas and terminates on data: [DONE]', () => {
      const stream =
        'data: {"id":"c1","choices":[{"delta":{"role":"assistant"}}]}\n\n' +
        'data: {"id":"c1","choices":[{"delta":{"content":"Hel"}}]}\n\n' +
        'data: {"id":"c1","choices":[{"delta":{"content":"lo!"}}]}\n\n' +
        'data: [DONE]\n\n';
      const { events, done } = parseAll([stream]);
      expect(done).toBe(true);
      const deltas = events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text);
      expect(deltas.join('')).toBe('Hello!');
      expect(events.at(-1)?.kind).toBe('end');
    });

    it('handles chunks split across arbitrary network boundaries', () => {
      const full = 'data: {"choices":[{"delta":{"content":"ab"}}]}\n\ndata: [DONE]\n\n';
      // Split mid-JSON and even mid-key.
      const { events, done } = parseAll([full.slice(0, 12), full.slice(12, 30), full.slice(30)]);
      expect(done).toBe(true);
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['ab']);
    });

    it('captures usage from the final chunk and attaches it to end', () => {
      const stream =
        'data: {"choices":[{"delta":{"content":"x"}}]}\n\n' +
        'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
        'data: [DONE]\n\n';
      const { events, done } = parseAll([stream]);
      expect(done).toBe(true);
      const end = events.find((e) => e.kind === 'end') as { usage?: { promptTokens?: number; completionTokens?: number } };
      expect(end.usage?.promptTokens).toBe(10);
      expect(end.usage?.completionTokens).toBe(5);
    });

    it('parses reasoning_content deltas separately from content', () => {
      const stream =
        'data: {"choices":[{"delta":{"reasoning_content":"think "}}]}\n\n' +
        'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n' +
        'data: [DONE]\n\n';
      const { events } = parseAll([stream]);
      expect(events.filter((e) => e.kind === 'reasoningDelta').map((e) => (e as { text: string }).text)).toEqual(['think ']);
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['answer']);
    });

    it('ignores keep-alive comment lines', () => {
      const stream = ': OPENAI STREAMING KEEP-ALIVE\n\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n';
      const { events, done } = parseAll([stream]);
      expect(done).toBe(true);
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['ok']);
    });

    it('skips malformed JSON frames without killing the stream', () => {
      const stream =
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
        'data: {not valid json!!\n\n' +
        'data: "just a string"\n\n' +
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
        'data: [DONE]\n\n';
      const { events, done, malformedCount } = parseAll([stream]);
      expect(done).toBe(true);
      expect(malformedCount).toBe(2);
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['a', 'b']);
    });

    it('treats a chunk with finish_reason and no delta as end of generation', () => {
      const stream =
        'data: {"choices":[{"delta":{"content":"done"}}]}\n\n' +
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
      const { events, done } = parseAll([stream]);
      expect(done).toBe(true);
      expect(events.at(-1)?.kind).toBe('end');
    });

    it('surfaces OpenAI-style error payloads as error events', () => {
      const stream = 'data: {"error":{"message":"context length exceeded"}}\n\n';
      const { events } = parseAll([stream]);
      expect(events.some((e) => e.kind === 'error' && (e as { message: string }).message === 'context length exceeded')).toBe(true);
    });

    it('handles CRLF line endings', () => {
      const stream = 'data: {"choices":[{"delta":{"content":"crlf"}}]}\r\n\r\ndata: [DONE]\r\n';
      const { events, done } = parseAll([stream]);
      expect(done).toBe(true);
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['crlf']);
    });

    it('flush() emits a trailing event when the stream ends without a final newline', () => {
      const parser = new SseStreamParser();
      expect(parser.feed('data: {"choices":[{"delta":{"content":"tail"}}]}').events).toHaveLength(0);
      const flushed = parser.flush();
      expect(flushed.events.filter((e) => e.kind === 'messageDelta')).toHaveLength(1);
    });
  });

  describe('native LM Studio named events', () => {
    it('maps chat.start / message.delta / chat.end with usage', () => {
      const stream =
        'event: chat.start\ndata: {"type":"chat.start"}\n\n' +
        'event: message.delta\ndata: {"content":"hi "}\n\n' +
        'event: message.delta\ndata: {"content":"there"}\n\n' +
        'event: chat.end\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n';
      const { events, done } = parseAll([stream]);
      expect(done).toBe(true);
      expect(events[0]?.kind).toBe('start');
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['hi ', 'there']);
      const end = events.find((e) => e.kind === 'end') as { usage?: { promptTokens?: number } };
      expect(end.usage?.promptTokens).toBe(3);
    });

    it('maps reasoning.delta and error events', () => {
      const stream =
        'event: reasoning.delta\ndata: {"content":"hmm"}\n\n' +
        'event: error\ndata: {"message":"boom"}\n\n';
      const { events } = parseAll([stream]);
      expect(events.some((e) => e.kind === 'reasoningDelta')).toBe(true);
      expect(events.some((e) => e.kind === 'error' && (e as { message: string }).message === 'boom')).toBe(true);
    });

    it('maps model loading / prompt processing events to phase details', () => {
      const stream =
        'event: model.loading\ndata: {"status":"Loading llama-3"}\n\n' +
        'event: prompt.processing\ndata: {"detail":"Processing…"}\n\n';
      const { events } = parseAll([stream]);
      expect(events.some((e) => e.kind === 'modelLoading')).toBe(true);
      expect(events.some((e) => e.kind === 'promptProcessing')).toBe(true);
    });

    it('supports unnamed frames carrying a type discriminator', () => {
      const stream = 'data: {"type":"message.delta","content":"typed"}\n\n';
      const { events } = parseAll([stream]);
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['typed']);
    });
  });
});
