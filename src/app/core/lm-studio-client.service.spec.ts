import { LmApiError } from './api-error';
import { LmStudioClient, normalizeModelEntry, type ClientConfig } from './lm-studio-client.service';
import { createFetchMock, GatedSseBody, sseBody, waitFor } from './testing/fetch-mock';
import type { GenerationSettings, StreamEvent } from './types/lm-studio.types';

const CONFIG: ClientConfig = { baseUrl: 'http://localhost:1234' };
const TOKEN_CONFIG: ClientConfig = { baseUrl: 'http://localhost:1234', apiToken: 'secret-token-xyz' };

const SETTINGS: GenerationSettings = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
  repeatPenalty: 1.1,
  maxOutputTokens: 2048,
  reasoningMode: 'auto'
};

const MODELS_JSON = JSON.stringify({
  data: [
    { id: 'meta-llama/llama-3.1-8b-instruct-q4_k_m', name: 'Llama 3.1 8B Instruct', owned_by: 'meta-llama', size: 4900000000, loaded: true },
    { id: 'mistralai/mistral-7b-instruct-v0.3-gguf', name: 'Mistral 7B Instruct v0.3' }
  ],
  loaded_model_id: 'meta-llama/llama-3.1-8b-instruct-q4_k_m'
});

async function collect(gen: AsyncGenerator<StreamEvent>): Promise<{ events: StreamEvent[]; error?: LmApiError }> {
  const events: StreamEvent[] = [];
  try {
    for await (const event of gen) events.push(event);
    return { events };
  } catch (err) {
    return { events, error: err as LmApiError };
  }
}

describe('LmStudioClient', () => {
  let client: LmStudioClient;
  let mock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    client = new LmStudioClient();
    mock = createFetchMock();
    vi.stubGlobal('fetch', mock.fn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('model discovery (native API)', () => {
    it('uses GET /api/v1/models and normalizes entries defensively', async () => {
      mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
      const models = await client.listModels(CONFIG);

      expect(mock.calls).toHaveLength(1);
      expect(mock.calls[0].url).toBe('http://localhost:1234/api/v1/models');
      expect(mock.calls[0].method).toBe('GET');

      expect(models).toHaveLength(2);
      const llama = models[0];
      expect(llama.id).toBe('meta-llama/llama-3.1-8b-instruct-q4_k_m');
      expect(llama.name).toBe('Llama 3.1 8B Instruct');
      expect(llama.publisher).toBe('meta-llama');
      expect(llama.quantization).toBe('q4_k_m'); // derived from the id
      expect(llama.parameterCount).toBe('8B'); // derived from the name
      expect(llama.sizeBytes).toBe(4900000000);
      expect(llama.chatCapable).toBe(true); // no capability data → assume chat-capable
      expect(llama.loaded).toBe(true);

      const mistral = models[1];
      // 'gguf' in the id is a format, not a quantization tag.
      expect(mistral.quantization).toBe(undefined);
      expect(mistral.parameterCount).toBe('7B');
      expect(mistral.format).toBe('GGUF');
      expect(mistral.loaded).toBe(false);
    });

    it('supports the { models: [...] } envelope variant', async () => {
      mock.setResponder(() => new Response(JSON.stringify({ models: [{ id: 'a/b' }] }), { status: 200 }));
      const models = await client.listModels(CONFIG);
      expect(models.map((m) => m.id)).toEqual(['a/b']);
    });

    it('maps non-2xx responses to a typed http error with body excerpt', async () => {
      mock.setResponder(() => new Response(JSON.stringify({ error: { message: 'no such endpoint' } }), { status: 404 }));
      await expect(client.listModels(CONFIG)).rejects.toMatchObject({ kind: 'http', status: 404 });
    });

    it('maps network failures (server down / CORS) to a guidance error without leaking the token', async () => {
      mock.setResponder(() => Promise.reject(new TypeError('Failed to fetch')));
      const err = (await client.listModels(TOKEN_CONFIG).catch((e) => e as LmApiError)) as LmApiError;
      expect(err.kind).toBe('network');
      expect(err.message).toContain('CORS');
      expect(err.message).not.toContain('secret-token-xyz');
    });

    it('sends the Authorization header only when a token is configured', async () => {
      mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
      await client.listModels(CONFIG);
      expect(mock.calls[0].headers.get('Authorization')).toBeNull();

      mock.reset();
      await client.listModels(TOKEN_CONFIG);
      expect(mock.calls[0].headers.get('Authorization')).toBe('Bearer secret-token-xyz');
    });
  });

  describe('load / unload (native API)', () => {
    it('loads via POST /api/v1/models/load with the model id body', async () => {
      mock.setResponder(() => new Response('{}', { status: 200 }));
      await client.loadModel(CONFIG, 'meta-llama/llama-3.1-8b-instruct-q4_k_m');

      expect(mock.calls[0].url).toBe('http://localhost:1234/api/v1/models/load');
      expect(mock.calls[0].method).toBe('POST');
      expect(JSON.parse(mock.calls[0].body ?? '{}')).toEqual({ model: 'meta-llama/llama-3.1-8b-instruct-q4_k_m' });
    });

    it('unloads via POST /api/v1/models/unload', async () => {
      mock.setResponder(() => new Response('{}', { status: 200 }));
      await client.unloadModel(CONFIG);

      expect(mock.calls[0].url).toBe('http://localhost:1234/api/v1/models/unload');
      expect(mock.calls[0].method).toBe('POST');
    });

    it('unloads with the instance identifier body required by current servers', async () => {
      mock.setResponder(() => new Response(JSON.stringify({ instance_id: 'm/1' }), { status: 200 }));
      await client.unloadModel(CONFIG, 'm/1');

      expect(mock.calls[0].url).toBe('http://localhost:1234/api/v1/models/unload');
      expect(JSON.parse(mock.calls[0].body ?? '{}')).toEqual({ instance_id: 'm/1' });
    });

    it('falls back to an empty unload body when no instance id is known (legacy servers)', async () => {
      mock.setResponder(() => new Response('{}', { status: 200 }));
      await client.unloadModel(CONFIG);
      expect(JSON.parse(mock.calls[0].body ?? '{}')).toEqual({});
    });

    it('resolves the parsed load response so callers can capture the instance id', async () => {
      mock.setResponder(() => new Response(
        JSON.stringify({ type: 'llm', instance_id: 'qwen/qwen3.8-27b', load_time_seconds: 2.258, status: 'loaded' }),
        { status: 200 }
      ));
      const result = await client.loadModel(CONFIG, 'qwen/qwen3.8-27b');
      expect(result?.instance_id).toBe('qwen/qwen3.8-27b');
      expect(result?.status).toBe('loaded');
    });

    it('resolves to undefined for a 200 load response without a JSON body', async () => {
      mock.setResponder(() => new Response('', { status: 200 }));
      const result = await client.loadModel(CONFIG, 'm/1');
      expect(result).toBeUndefined();
    });

    it('surfaces load failures as typed http errors', async () => {
      mock.setResponder(() => new Response(JSON.stringify({ error: 'model not found' }), { status: 400 }));
      await expect(client.loadModel(CONFIG, 'missing/model')).rejects.toMatchObject({ kind: 'http', status: 400 });
    });
  });

  describe('chat generation (OpenAI-compatible endpoint)', () => {
    const HISTORY = [
      { role: 'system' as const, content: 'You are terse.' },
      { role: 'user' as const, content: 'Hello' },
      { role: 'assistant' as const, content: 'Hi!' },
      { role: 'user' as const, content: 'And again?' }
    ];

    function streamResponder(chunks: string[]): (call: unknown) => Response {
      return () => new Response(sseBody(chunks), { status: 200 });
    }

    it('POSTs the complete in-memory history to /v1/chat/completions with store:false', async () => {
      mock.setResponder(streamResponder([
        'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
        'data: [DONE]\n\n'
      ]));

      await collect(client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS }));

      expect(mock.calls).toHaveLength(1);
      const call = mock.calls[0];
      expect(call.url).toBe('http://localhost:1234/v1/chat/completions');
      expect(call.method).toBe('POST');

      const body = JSON.parse(call.body ?? '{}');
      expect(body.model).toBe('m/1');
      // Complete history, system prompt included — the fix for Issue 1.
      expect(body.messages).toEqual(HISTORY);
      expect(body.stream).toBe(true);
      expect(body.store).toBe(false);
      expect(body.temperature).toBe(0.7);
      expect(body.top_p).toBe(0.95);
      expect(body.top_k).toBe(40);
      expect(body.repeat_penalty).toBe(1.1);
      expect(body.max_tokens).toBe(2048);
      expect(body.stream_options).toEqual({ include_usage: true });
    });

    it('maps reasoning mode to reasoning_effort on the request body', async () => {
      const enabled: GenerationSettings = { ...SETTINGS, reasoningMode: 'enabled' };
      mock.setResponder(streamResponder(['data: [DONE]\n\n']));
      await collect(client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: enabled }));
      let body = JSON.parse(mock.calls[0].body ?? '{}');
      expect(body.reasoning).toBe('required');
      expect(body.reasoning_effort).toBe('high');

      mock.reset();
      const disabled: GenerationSettings = { ...SETTINGS, reasoningMode: 'disabled' };
      mock.setResponder(streamResponder(['data: [DONE]\n\n']));
      await collect(client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: disabled }));
      body = JSON.parse(mock.calls[0].body ?? '{}');
      expect(body.reasoning).toBe('off');
      expect(body.reasoning_effort).toBe('minimal');

      // Auto mode omits both knobs so the server decides.
      mock.reset();
      mock.setResponder(streamResponder(['data: [DONE]\n\n']));
      await collect(client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS }));
      body = JSON.parse(mock.calls[0].body ?? '{}');
      expect(body.reasoning).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
    });

    it('streams deltas and terminates cleanly on data: [DONE] with usage', async () => {
      mock.setResponder(streamResponder([
        'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n' // split frame boundary
      ]));

      const { events, error } = await collect(client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS }));
      expect(error).toBeUndefined();
      const text = events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text).join('');
      expect(text).toBe('Hello');
      expect(events.at(-1)?.kind).toBe('end');
    });

    it('maps a non-2xx chat response to a typed http error', async () => {
      mock.setResponder(() => new Response(JSON.stringify({ error: { message: 'model not loaded' } }), { status: 400 }));
      const err = (await client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS }).next().then(
        () => null,
        (e) => e as LmApiError
      )) as LmApiError;
      expect(err.kind).toBe('http');
      expect(err.status).toBe(400);
    });

    it('rejects with kind "aborted" when the signal is already aborted', async () => {
      const controller = new AbortController();
      controller.abort();
      mock.setResponder((call) => {
        if (call.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
        return new Response(sseBody(['data: [DONE]\n\n']), { status: 200 });
      });

      const err = (await client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS, signal: controller.signal }).next().then(
        () => null,
        (e) => e as LmApiError
      )) as LmApiError;
      expect(err.kind).toBe('aborted');
    });

    it('keeps partial content and surfaces a network error when the connection drops mid-stream', async () => {
      const controller = new AbortController();
      const gated = new GatedSseBody(controller.signal);
      mock.setResponder(() => new Response(gated.stream, { status: 200 }));

      const gen = client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS, signal: controller.signal });
      const pending = collect(gen);

      await waitFor(() => gated.pendingReads > 0);
      gated.push('data: {"choices":[{"delta":{"content":"par"}}]}\n\n');
      await waitFor(() => gated.pendingReads > 0);
      gated.fail(new TypeError('socket hang up')); // connection loss mid-stream

      const { events, error } = await pending;
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text).join('')).toBe('par');
      expect(error?.kind).toBe('network');
    });

    it('recovers from malformed frames inside an otherwise valid stream', async () => {
      mock.setResponder(streamResponder([
        'data: {"choices":[{"delta":{"content":"a"}}]}\n\n',
        'garbage line without a field\n\ndata: {{{broken json\n\n',
        'data: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: [DONE]\n\n'
      ]));

      const { events, error } = await collect(client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS }));
      expect(error).toBeUndefined();
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['a', 'b']);
    });

    it('falls back to a single non-streaming completion when the response has no body stream', async () => {
      const payload = { choices: [{ message: { content: 'full answer' } }], usage: { prompt_tokens: 4, completion_tokens: 9 } };
      mock.setResponder(() => ({ ok: true, status: 200, json: async () => payload }) as unknown as Response);

      const { events, error } = await collect(client.chatStream(CONFIG, { modelId: 'm/1', messages: HISTORY, settings: SETTINGS }));
      expect(error).toBeUndefined();
      expect(events.filter((e) => e.kind === 'messageDelta').map((e) => (e as { text: string }).text)).toEqual(['full answer']);
      const end = events.find((e) => e.kind === 'end') as { usage?: { completionTokens?: number } };
      expect(end.usage?.completionTokens).toBe(9);
    });
  });

  describe('Issue 1 regression — /api/v0 must never be requested', () => {
    it('no request in the full workflow (discover → load → chat → unload) targets /api/v0', async () => {
      mock.setResponder((call) => {
        if (call.url.endsWith('/api/v1/models')) return new Response(MODELS_JSON, { status: 200 });
        if (call.url.endsWith('/v1/chat/completions')) {
          return new Response(
            sseBody(['data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n']),
            { status: 200 }
          );
        }
        return new Response('{}', { status: 200 }); // load / unload
      });

      await client.listModels(CONFIG);
      await client.loadModel(CONFIG, 'meta-llama/llama-3.1-8b-instruct-q4_k_m');
      await collect(
        client.chatStream(CONFIG, { modelId: 'm/1', messages: [{ role: 'user', content: 'Hello' }], settings: SETTINGS })
      );
      await client.unloadModel(CONFIG);

      expect(mock.calls.length).toBeGreaterThanOrEqual(4);
      for (const call of mock.calls) {
        // The regression assertion: the legacy endpoint must never appear.
        expect(call.url, `unexpected request to ${call.url}`).not.toContain('/api/v0');
      }
      const chatCall = mock.calls.find((c) => c.method === 'POST' && c.url.includes('chat/completions'));
      expect(chatCall?.url).toBe('http://localhost:1234/v1/chat/completions');
    });
  });

  describe('live LM Studio /api/v1/models contract (current field names)', () => {
    // Captured from a running LM Studio server. The response uses `key`,
    // `display_name`, `size_bytes`, an object-valued `quantization`,
    // `params_string`, `loaded_instances`, `publisher` and an object-valued
    // `capabilities` — none of which the legacy client shape assumed.
    const LIVE_MODELS_JSON = JSON.stringify({
      models: [
        {
          type: 'llm',
          publisher: 'qwen',
          key: 'qwen/qwen3.8-27b',
          display_name: 'Qwen3.8 27B',
          architecture: 'qwen35',
          quantization: { name: 'Q6_K', bits_per_weight: 6 },
          size_bytes: 23362325904,
          params_string: '27B',
          loaded_instances: [{ id: 'qwen/qwen3.8-27b', config: { context_length: 171008 } }],
          max_context_length: 262144,
          format: 'gguf',
          capabilities: { vision: true, trained_for_tool_use: true, reasoning: { allowed_options: ['off', 'on'], default: 'xhigh' } }
        },
        {
          type: 'llm',
          publisher: 'qwen',
          key: 'qwen/qwen3.5-35b-a3b',
          display_name: 'Qwen3.5 35B A3B',
          architecture: 'qwen35moe',
          quantization: { name: 'Q6_K', bits_per_weight: 6 },
          size_bytes: 29417152605,
          params_string: '35B-A3B',
          loaded_instances: [],
          format: 'gguf',
          capabilities: { vision: true, trained_for_tool_use: true, reasoning: { allowed_options: ['off', 'on'], default: 'on' } }
        },
        {
          type: 'embedding',
          publisher: 'nomic-ai',
          key: 'text-embedding-nomic-embed-text-v1.5',
          display_name: 'Nomic Embed Text v1.5',
          quantization: { name: 'Q4_K_M', bits_per_weight: 4 },
          size_bytes: 84106624,
          params_string: null,
          loaded_instances: [],
          max_context_length: 2048,
          format: 'gguf'
        }
      ]
    });

    it('normalizes the current field names into catalogue models', async () => {
      mock.setResponder(() => new Response(LIVE_MODELS_JSON, { status: 200 }));
      const models = await client.listModels(CONFIG);

      expect(models).toHaveLength(3);
      const [qwen, moe, embed] = models;

      // Loaded LLM entry: id from `key`, name from `display_name`, size from
      // `size_bytes`, quantization from the `quantization.name` object,
      // params from `params_string`, loaded state from a non-empty
      // `loaded_instances`, instance id captured.
      expect(qwen.id).toBe('qwen/qwen3.8-27b');
      expect(qwen.name).toBe('Qwen3.8 27B');
      expect(qwen.publisher).toBe('qwen');
      expect(qwen.quantization).toBe('Q6_K');
      expect(qwen.parameterCount).toBe('27B');
      expect(qwen.sizeBytes).toBe(23362325904);
      expect(qwen.format).toBe('GGUF');
      expect(qwen.chatCapable).toBe(true);
      expect(qwen.loaded).toBe(true);
      expect(qwen.instanceId).toBe('qwen/qwen3.8-27b');
      expect(qwen.capabilities).toContain('vision');
      expect(qwen.capabilities).toContain('reasoning');

      // Unloaded LLM entry.
      expect(moe.id).toBe('qwen/qwen3.5-35b-a3b');
      expect(moe.name).toBe('Qwen3.5 35B A3B');
      expect(moe.parameterCount).toBe('35B-A3B');
      expect(moe.loaded).toBe(false);
      expect(moe.instanceId).toBeUndefined();

      // Embedding entry: not chat-capable (type), no derived parameter count.
      expect(embed.id).toBe('text-embedding-nomic-embed-text-v1.5');
      expect(embed.chatCapable).toBe(false);
      expect(embed.quantization).toBe('Q4_K_M');
      expect(embed.parameterCount).toBeUndefined();
      expect(embed.loaded).toBe(false);
    });
  });

  describe('normalizeModelEntry (unit)', () => {
    it('derives quantization and parameter count from the name when fields are missing', () => {
      const model = normalizeModelEntry({ id: 'qwen/qwen2.5-14b-instruct-q8_0' });
      expect(model.quantization).toBe('q8_0');
      expect(model.parameterCount).toBe('14B');
      expect(model.chatCapable).toBe(true);
    });

    it('respects explicit capabilities for chat-capability detection', () => {
      const embedding = normalizeModelEntry({ id: 'bge/bge-m3', capabilities: ['embedding'] });
      expect(embedding.chatCapable).toBe(false);
      const chat = normalizeModelEntry({ id: 'x/y', capabilities: ['chat'] });
      expect(chat.chatCapable).toBe(true);
    });

    it('marks the loaded model from the top-level loaded_model_id when entries lack flags', () => {
      const a = normalizeModelEntry({ id: 'a/1' }, 'b/2');
      const b = normalizeModelEntry({ id: 'b/2' }, 'b/2');
      expect(a.loaded).toBe(false);
      expect(b.loaded).toBe(true);
    });
  });
});
