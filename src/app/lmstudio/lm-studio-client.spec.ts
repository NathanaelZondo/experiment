import { LmStudioClient, LmStudioRequestError, parseLoadResponse, parseModel, parseModelsResponse } from './lm-studio-client';
import { formatBytes, formatParams, normalizeBaseUrl } from './format';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('format helpers', () => {
  it('formats bytes into human-readable units', () => {
    expect(formatBytes(512)).toBe('512 B');
    // 4900 MiB = 4.785 GiB → "4.8 GB"
    expect(formatBytes(4900 * 1024 * 1024)).toBe('4.8 GB');
    // 5_300_000_000 bytes ≈ 4.93 GiB → "4.9 GB"
    expect(formatBytes(5_300_000_000)).toBe('4.9 GB');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(NaN)).toBe('—');
  });

  it('formats parameter counts in billions', () => {
    expect(formatParams(8)).toBe('8B');
    expect(formatParams(13.05)).toBe('13.1B');
    expect(formatParams(undefined)).toBe('—');
  });

  it('normalises base URLs by trimming and stripping trailing slashes', () => {
    expect(normalizeBaseUrl(' http://localhost:1234/ ')).toBe('http://localhost:1234');
    expect(normalizeBaseUrl('http://host:9090///')).toBe('http://host:9090');
  });
});

describe('parseModel / parseModelsResponse', () => {
  it('maps a full raw entry into the typed contract', () => {
    const model = parseModel({
      id: 'Llama-3.2-8B-Instruct-Q4_K_M.gguf',
      publisher: 'Meta',
      quantization: 'Q4_K_M',
      parameter_count: 8,
      size: 5_300_000_000,
      format: 'gguf',
      capabilities: ['chat'],
      loaded: true,
    });
    expect(model).toEqual({
      id: 'Llama-3.2-8B-Instruct-Q4_K_M.gguf',
      publisher: 'Meta',
      quantization: 'Q4_K_M',
      parameterCount: 8,
      sizeBytes: 5_300_000_000,
      format: 'gguf',
      capabilities: ['chat'],
      loaded: true,
    });
  });

  it('tolerates missing and null fields', () => {
    const model = parseModel({ id: 'tiny-model' });
    expect(model?.id).toBe('tiny-model');
    expect(model?.publisher).toBeUndefined();
    expect(model?.capabilities).toEqual([]);
    expect(model?.loaded).toBe(false);
  });

  it('drops entries without a usable id', () => {
    expect(parseModel({ publisher: 'Nope' })).toBeNull();
    expect(parseModel({ id: '   ' })).toBeNull();
  });

  it('extracts the list from the standard envelope and skips bad entries', () => {
    const models = parseModelsResponse({ object: 'list', data: [{ id: 'a' }, null, 'junk', { id: 'b' }] });
    expect(models.map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('returns an empty list for unexpected shapes', () => {
    expect(parseModelsResponse(null)).toEqual([]);
    expect(parseModelsResponse({ data: 'not-an-array' })).toEqual([]);
    expect(parseModelsResponse([1, 2])).toEqual([]);
  });

  describe('current wire shape ({ models: [...] } with key / display_name / loaded_instances)', () => {
    it('maps a full current-shape entry', () => {
      const model = parseModel({
        type: 'llm',
        publisher: 'lmstudio-community',
        key: 'nvidia-nemotron-3.5-lightning-30b-a3b',
        display_name: 'NVIDIA Nemotron 3.5 Lightning 30B A3B',
        quantization: { name: 'Q8_0', bits_per_weight: 8 },
        size_bytes: 33_585_494_976,
        params_string: '30B',
        loaded_instances: [{ id: 'nvidia-nemotron-3.5-lightning-30b-a3b' }],
        format: 'gguf',
        capabilities: { vision: false, trained_for_tool_use: true, reasoning: { default: 'on' } },
      });
      expect(model).toEqual({
        id: 'nvidia-nemotron-3.5-lightning-30b-a3b',
        displayName: 'NVIDIA Nemotron 3.5 Lightning 30B A3B',
        publisher: 'lmstudio-community',
        quantization: 'Q8_0',
        parameterCount: 30,
        sizeBytes: 33_585_494_976,
        format: 'gguf',
        capabilities: ['chat', 'tools', 'reasoning'],
        loaded: true,
      });
    });

    it('marks models without instances as not loaded and derives chat capability from type', () => {
      const model = parseModel({ type: 'llm', key: 'some-model', loaded_instances: [] });
      expect(model?.loaded).toBe(false);
      expect(model?.capabilities).toContain('chat');
    });

    it('extracts the list from the { models } envelope and skips bad entries', () => {
      const models = parseModelsResponse({
        models: [{ key: 'a' }, null, 'junk', { id: 'b' }], // Mix of current and classic ids.
      });
      expect(models.map((m) => m.id)).toEqual(['a', 'b']);
    });

    it('parses fractional parameter strings like "13.1B"', () => {
      const model = parseModel({ key: 'x', params_string: '13.1B' });
      expect(model?.parameterCount).toBe(13.1);
    });
  });
});

describe('parseLoadResponse', () => {
  it('maps a full load response into the applied configuration', () => {
    const config = parseLoadResponse({ model: 'm1', settings: { gpu_offload: true, context_length: 4096 } });
    expect(config?.modelId).toBe('m1');
    expect(config?.settings).toEqual({ gpu_offload: true, context_length: 4096 });
    expect(typeof config?.at).toBe('number');
  });

  it('tolerates missing settings', () => {
    const config = parseLoadResponse({ model: 'm1' });
    expect(config?.modelId).toBe('m1');
    expect(config?.settings).toEqual({});
  });

  it('returns null for unexpected shapes', () => {
    expect(parseLoadResponse(null)).toBeNull();
    expect(parseLoadResponse({})).toBeNull();
    expect(parseLoadResponse({ model: '   ', settings: {} })).toBeNull();
  });
});

describe('LmStudioClient.listModels', () => {
  const client = new LmStudioClient();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the models endpoint with a normalised URL and no auth header when token is empty', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [{ id: 'm1' }] }));

    const models = await client.listModels('http://localhost:1234/', '');

    expect(models[0].id).toBe('m1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/api/v1/models');
    expect(new Headers(init.headers).get('Authorization')).toBeNull();
  });

  it('sends a Bearer token when one is configured', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [] }));

    await client.listModels('http://localhost:1234', 'secret-token');

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
  });

  it('classifies network failures with server-not-running and CORS guidance', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }));

    const promise = client.listModels('http://localhost:1234');
    await expect(promise).rejects.toBeInstanceOf(LmStudioRequestError);
    try {
      await promise;
    } catch (error) {
      const classified = error as LmStudioRequestError;
      expect(classified.classification.kind).toBe('network');
      const guidanceText = classified.classification.guidance.join('\n').toLowerCase();
      expect(guidanceText).toContain('lm studio is running');
      expect(guidanceText).toContain('cross-origin');
    }
  });

  it('classifies aborts as timeouts', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

    const promise = client.listModels('http://localhost:1234');
    await expect(promise).rejects.toMatchObject({ classification: { kind: 'timeout' } });
  });

  it('classifies 401 responses as auth errors without echoing the token', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    const promise = client.listModels('http://localhost:1234', 'secret-token');
    await expect(promise).rejects.toBeInstanceOf(LmStudioRequestError);
    try {
      await promise;
    } catch (error) {
      const classified = error as LmStudioRequestError;
      expect(classified.classification.kind).toBe('auth');
      expect(JSON.stringify(classified)).not.toContain('secret-token');
    }
  });

  it('classifies other HTTP errors with the status code', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));

    const promise = client.listModels('http://localhost:1234');
    await expect(promise).rejects.toBeInstanceOf(LmStudioRequestError);
    try {
      await promise;
    } catch (error) {
      const classified = error as LmStudioRequestError;
      expect(classified.classification.kind).toBe('http');
      expect(classified.classification.message).toContain('503');
    }
  });

  it('returns an empty list when the body is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(new Response('<html>oops</html>', { status: 200 }));
    await expect(client.listModels('http://localhost:1234')).resolves.toEqual([]);
  });

  it('forwards the abort signal to fetch', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('Aborted')))));

    const promise = client.listModels('http://localhost:1234', undefined, controller.signal);
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(LmStudioRequestError);
  });
});

describe('LmStudioClient.loadModel / unloadModel', () => {
  const client = new LmStudioClient();
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs to the load endpoint with LM Studio defaults (no settings) and a Bearer token', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'm1', settings: { gpu_offload: true } }));

    const config = await client.loadModel('http://localhost:1234/', 'm1', 'secret-token');

    expect(config.modelId).toBe('m1');
    expect(config.settings).toEqual({ gpu_offload: true });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/api/v1/models/load');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ model: 'm1' });
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret-token');
  });

  it('falls back to the requested id when the load response has no settings', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'm2' }));

    const config = await client.loadModel('http://localhost:1234', 'm2');

    expect(config.modelId).toBe('m2');
    expect(config.settings).toEqual({});
  });

  it('treats a non-JSON 2xx load response as success with the requested id', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));

    const config = await client.loadModel('http://localhost:1234', 'm3');

    expect(config.modelId).toBe('m3');
    expect(config.settings).toEqual({});
  });

  it('classifies load failures with the same guidance as other requests', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }));

    const promise = client.loadModel('http://localhost:1234', 'm1');
    await expect(promise).rejects.toBeInstanceOf(LmStudioRequestError);
  });

  it('classifies HTTP load failures with the status code', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

    const promise = client.loadModel('http://localhost:1234', 'm1');
    await expect(promise).rejects.toMatchObject({ classification: { kind: 'http' } });
  });

  it('POSTs to the unload endpoint with a model id when given', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await client.unloadModel('http://localhost:1234', 'm1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/api/v1/models/unload');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ model: 'm1' });
  });

  it('sends no body when unloading without a specific model', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));

    await client.unloadModel('http://localhost:1234');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });
});
