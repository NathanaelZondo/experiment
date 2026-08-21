import { LmStudioChatClient, parseChatChunk, parseChatCompletion, parseStats, parseUsage } from './chat-client';
import { ChatStreamEvent } from './chat-types';

/** Builds a Response whose body is an SSE stream delivered in the given chunks. */
function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('parseUsage / parseStats', () => {
  it('maps the OpenAI-style usage block including reasoning tokens', () => {
    const usage = parseUsage({
      prompt_tokens: 59,
      completion_tokens: 16,
      total_tokens: 75,
      completion_tokens_details: { reasoning_tokens: 16 },
    });
    expect(usage).toEqual({ promptTokens: 59, completionTokens: 16, totalTokens: 75, reasoningTokens: 16 });
  });

  it('returns undefined for missing or empty usage', () => {
    expect(parseUsage(null)).toBeUndefined();
    expect(parseUsage({})).toBeUndefined();
  });

  it('converts stats from seconds to milliseconds', () => {
    const stats = parseStats({ tokens_per_second: 42.1, time_to_first_token: 0.156, generation_time: 0.536, stop_reason: 'stop' });
    expect(stats).toEqual({ tokensPerSecond: 42.1, timeToFirstTokenMs: 156, generationTimeMs: 536, stopReason: 'stop' });
  });

  it('returns undefined for an empty stats block', () => {
    expect(parseStats(null)).toBeUndefined();
    expect(parseStats({})).toBeUndefined();
  });
});

describe('parseChatCompletion (non-streaming)', () => {
  it('extracts content, reasoning, finish reason and aggregated stats', () => {
    const result = parseChatCompletion({
      id: 'chatcmpl-1',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello!', reasoning_content: 'thinking…' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      stats: { tokens_per_second: 42.1, time_to_first_token: 0.156, generation_time: 0.536 },
    });
    expect(result.content).toBe('Hello!');
    expect(result.reasoningContent).toBe('thinking…');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.promptTokens).toBe(10);
    expect(result.stats?.tokensPerSecond).toBe(42.1);
  });

  it('tolerates unexpected shapes', () => {
    const result = parseChatCompletion(null);
    expect(result.content).toBe('');
    expect(result.usage).toBeUndefined();
  });
});

describe('parseChatChunk (streaming)', () => {
  it('maps a content delta', () => {
    const event = parseChatChunk({ choices: [{ index: 0, delta: { role: 'assistant', content: 'Hel' } }] });
    expect(event).toEqual({ kind: 'delta', delta: { content: 'Hel', contentChanged: true, reasoningContent: undefined, reasoningChanged: false } });
  });

  it('maps a reasoning delta', () => {
    const event = parseChatChunk({ choices: [{ index: 0, delta: { reasoning_content: 'think' } }] });
    expect(event).toMatchObject({ kind: 'delta', delta: { reasoningContent: 'think', reasoningChanged: true } });
  });

  it('maps a finish chunk with stats', () => {
    const event = parseChatChunk({
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      stats: { tokens_per_second: 42 },
    });
    expect(event).toMatchObject({ kind: 'finish', finishReason: 'stop', stats: { tokensPerSecond: 42 } });
  });

  it('maps an in-band error frame', () => {
    const event = parseChatChunk({ error: { message: 'context length exceeded' } });
    expect(event).toEqual({ kind: 'error', message: 'context length exceeded' });
  });

  it('returns null for empty frames and non-objects', () => {
    expect(parseChatChunk({ choices: [{ index: 0, delta: {} }] })).toBeNull();
    expect(parseChatChunk(null)).toBeNull();
    expect(parseChatChunk('junk')).toBeNull();
  });
});

describe('LmStudioChatClient.complete (non-streaming)', () => {
  const client = new LmStudioChatClient();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the native chat endpoint with system prompt and history, no auth header when token is empty', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } })
    );

    const result = await client.complete('http://localhost:1234/', 'model-x', [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'hi' },
    ]);

    expect(result.content).toBe('ok');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/api/v0/chat/completions');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('model-x');
    expect(body.stream).toBe(false);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'be concise' });
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('sends a Bearer token when configured', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' } }] }));
    await client.complete('http://localhost:1234', 'm', [], undefined, 'secret-token');
    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
  });

  it('classifies network failures with guidance that never contains the token', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }));
    const promise = client.complete('http://localhost:1234', 'm', [], undefined, 'secret-token');
    await expect(promise).rejects.toMatchObject({ classification: { kind: 'network' } });
  });

  it('classifies HTTP errors with the status code', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const promise = client.complete('http://localhost:1234', 'm', []);
    await expect(promise).rejects.toMatchObject({ classification: { kind: 'http' } });
  });

  it('treats a non-JSON 2xx body as an empty result', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 200 }));
    const result = await client.complete('http://localhost:1234', 'm', []);
    expect(result.content).toBe('');
  });

  it('merges defined request options into the body and omits undefined ones', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' } }] }));
    await client.complete(
      'http://localhost:1234',
      'm',
      [],
      { temperature: 0.7, top_p: 1, top_k: 40, repeat_penalty: 1.1, max_tokens: 2048 }
    );

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      temperature: 0.7,
      top_p: 1,
      top_k: 40,
      repeat_penalty: 1.1,
      max_tokens: 2048,
    });
    // Undefined keys are never serialized.
    expect(body.reasoning_effort).toBeUndefined();
  });

  it('sends reasoning_effort when the mode is not off', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: '' } }] }));
    await client.complete('http://localhost:1234', 'm', [], { temperature: 0.5, reasoning_effort: 'high' });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.reasoning_effort).toBe('high');
  });
});

describe('LmStudioChatClient.stream (streaming SSE)', () => {
  const client = new LmStudioChatClient();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams deltas in order and stops at the [DONE] sentinel', async () => {
    const chunk = (delta: Record<string, unknown>) => JSON.stringify({ choices: [{ index: 0, delta }] });
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        `data: ${chunk({ role: 'assistant', content: 'Hel' })}\n\n`,
        `data: ${chunk({ content: 'lo' })}\n\ndata: ${chunk({})}\n\n`, // Two frames in one chunk.
        `data: [DONE]\n\n`,
      ])
    );

    const events: ChatStreamEvent[] = [];
    await client.stream('http://localhost:1234', 'm', [], (e) => events.push(e));

    expect(events.map((e) => e.kind)).toEqual(['delta', 'delta']);
    expect((events[0] as { delta: { content?: string } }).delta.content).toBe('Hel');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/api/v0/chat/completions');
    expect(JSON.parse(init.body).stream).toBe(true);
  });

  it('reassembles frames split across chunk boundaries and captures finish stats', async () => {
    const first = 'data: {"choices":[{"index":0,"delta":{"content":"He'; // Split mid-JSON.
    const second = 'llo"}}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"stats":{"tokens_per_second":42}}\n\n';
    fetchMock.mockResolvedValueOnce(sseResponse([first, second]));

    const events: ChatStreamEvent[] = [];
    await client.stream('http://localhost:1234', 'm', [], (e) => events.push(e));

    expect(events).toHaveLength(2);
    expect((events[0] as { delta: { content?: string } }).delta.content).toBe('Hello');
    expect(events[1]).toMatchObject({ kind: 'finish', finishReason: 'stop' });
  });

  it('skips malformed JSON lines without crashing the run', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'data: not-json-at-all\n\n',
        'data: {"choices":[{"index":0,"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n',
      ])
    );

    const events: ChatStreamEvent[] = [];
    await client.stream('http://localhost:1234', 'm', [], (e) => events.push(e));
    expect(events).toHaveLength(1);
    expect((events[0] as { delta: { content?: string } }).delta.content).toBe('ok');
  });

  it('surfaces in-band error frames', async () => {
    fetchMock.mockResolvedValueOnce(sseResponse(['data: {"error":{"message":"boom"}}\n\n']));
    const events: ChatStreamEvent[] = [];
    await client.stream('http://localhost:1234', 'm', [], (e) => events.push(e));
    expect(events).toEqual([{ kind: 'error', message: 'boom' }]);
  });

  it('aborts the in-flight stream when the signal fires', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' })))));

    const promise = client.stream('http://localhost:1234', 'm', [], () => undefined, undefined, undefined, controller.signal);
    controller.abort();
    await expect(promise).rejects.toMatchObject({ classification: { kind: 'timeout' } });
  });

  it('classifies HTTP errors from the stream request', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const promise = client.stream('http://localhost:1234', 'm', [], () => undefined);
    await expect(promise).rejects.toMatchObject({ classification: { kind: 'auth' } });
  });
});
