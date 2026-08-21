import { TestBed } from '@angular/core/testing';
import { LmStudioService } from './lm-studio.service';
import { DEFAULT_LM_STUDIO_URL } from './lm-studio-client';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** A fetch promise we can resolve manually to control test ordering. */
function deferredFetch(): { promise: Promise<Response>; resolve: (v: Response) => void; reject: (e: unknown) => void } {
  let resolveFn!: (v: Response) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<Response>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  return { promise, resolve: resolveFn, reject: rejectFn };
}

describe('LmStudioService', () => {
  let service: LmStudioService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LmStudioService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts disconnected with the default URL and no token (RAM only)', () => {
    expect(service.status()).toBe('disconnected');
    expect(service.serverUrl()).toBe(DEFAULT_LM_STUDIO_URL);
    expect(service.apiToken()).toBe('');
    expect(service.models().length).toBe(0);
  });

  it('transitions to connected and stores the model catalogue', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [{ id: 'm1', capabilities: ['chat'] }] }));

    await service.testConnection();

    expect(service.status()).toBe('connected');
    expect(service.models().map((m) => m.id)).toEqual(['m1']);
    expect(service.lastCheckedAt()).not.toBeNull();
  });

  it('transitions to failed with guidance when the server is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }));

    await service.testConnection();

    expect(service.status()).toBe('failed');
    expect(service.error()?.kind).toBe('network');
    const guidance = (service.error()?.guidance ?? []).join('\n').toLowerCase();
    expect(guidance).toContain('lm studio is running');
    expect(guidance).toContain('cross-origin');
  });

  it('fails fast without calling fetch when the URL is blank', async () => {
    service.serverUrl.set('   ');

    await service.testConnection();

    expect(service.status()).toBe('failed');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores stale responses from superseded tests', async () => {
    const first = deferredFetch();
    fetchMock.mockReturnValueOnce(first.promise);

    const run1 = service.testConnection();
    // A second, newer test supersedes the first.
    const second = deferredFetch();
    fetchMock.mockReturnValueOnce(second.promise);
    const run2 = service.testConnection();

    // The stale response arrives first — it must be ignored.
    first.resolve(jsonResponse({ object: 'list', data: [{ id: 'stale' }] }));
    await run1;
    expect(service.status()).toBe('checking');
    expect(service.models().length).toBe(0);

    second.resolve(jsonResponse({ object: 'list', data: [{ id: 'fresh' }] }));
    await run2;
    expect(service.status()).toBe('connected');
    expect(service.models().map((m) => m.id)).toEqual(['fresh']);
  });

  it('clears stale catalogue data when a re-test fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [{ id: 'old' }] }));
    await service.testConnection();
    expect(service.status()).toBe('connected');

    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }));
    await service.testConnection();

    expect(service.status()).toBe('failed');
    expect(service.models().length).toBe(0);
    expect(service.lastCheckedAt()).toBeNull();
  });

  it('resets to disconnected when the URL changes after a result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [{ id: 'm1' }] }));
    await service.testConnection();
    expect(service.status()).toBe('connected');

    service.setServerUrl('http://other-host:9090/');
    expect(service.serverUrl()).toBe('http://other-host:9090');
    expect(service.status()).toBe('disconnected');
    expect(service.models().length).toBe(0);
  });

  it('resets to disconnected when the token changes after a result', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [{ id: 'm1' }] }));
    await service.testConnection();

    service.setApiToken('new-token');
    expect(service.apiToken()).toBe('new-token');
    expect(service.status()).toBe('disconnected');
  });

  it('filters the catalogue to chat-capable models when requested', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        object: 'list',
        data: [
          { id: 'chat-model', capabilities: ['chat'] },
          { id: 'embed-model', capabilities: ['embedding'] },
        ],
      })
    );
    await service.testConnection();

    expect(service.visibleModels().length).toBe(2);
    service.chatOnly.set(true);
    expect(service.visibleModels().map((m) => m.id)).toEqual(['chat-model']);
  });

  it('sends the configured token to fetch', async () => {
    service.apiToken.set('secret');
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: 'list', data: [] }));

    await service.testConnection();

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer secret');
  });
});

describe('LmStudioService — model lifecycle (one model at a time)', () => {
  let service: LmStudioService;
  let fetchMock: ReturnType<typeof vi.fn>;

  function catalogResponse(loadedIds: string[]): Response {
    return jsonResponse({
      object: 'list',
      data: ['a-model', 'b-model'].map((id) => ({ id, capabilities: ['chat'], loaded: loadedIds.includes(id) })),
    });
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(LmStudioService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a model, captures the applied config and refreshes the catalogue afterwards', async () => {
    // load call, then the post-operation catalogue refresh.
    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'b-model', settings: { gpu_offload: true } }));
    fetchMock.mockResolvedValueOnce(catalogResponse(['b-model']));

    await service.loadModel('b-model');

    expect(service.lifecyclePhase()).toBe('idle');
    expect(service.lastAppliedConfig()?.modelId).toBe('b-model');
    expect(service.lastAppliedConfig()?.settings).toEqual({ gpu_offload: true });
    // Catalogue was refreshed after the lifecycle operation.
    expect(service.models().find((m) => m.id === 'b-model')?.loaded).toBe(true);
  });

  it('unloads any other loaded model before loading a new one', async () => {
    service.models.set([
      { id: 'a-model', capabilities: ['chat'], loaded: true },
      { id: 'b-model', capabilities: ['chat'], loaded: false },
    ]);
    fetchMock.mockResolvedValueOnce(jsonResponse({})); // unload a-model
    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'b-model' })); // load b-model
    fetchMock.mockResolvedValueOnce(catalogResponse(['b-model'])); // refresh

    await service.loadModel('b-model');

    const urls = fetchMock.mock.calls.map(([url]) => url);
    expect(urls[0]).toBe('http://localhost:1234/api/v1/models/unload');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ model: 'a-model' });
    expect(urls[1]).toBe('http://localhost:1234/api/v1/models/load');
    // Never more than one loaded model is retained.
    const loaded = service.models().filter((m) => m.loaded);
    expect(loaded.map((m) => m.id)).toEqual(['b-model']);
  });

  it('recovers gracefully when the pre-unload succeeds but the replacement load fails', async () => {
    service.models.set([
      { id: 'a-model', capabilities: ['chat'], loaded: true },
      { id: 'b-model', capabilities: ['chat'], loaded: false },
    ]);
    fetchMock.mockResolvedValueOnce(jsonResponse({})); // unload a-model succeeds
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })); // load fails
    fetchMock.mockResolvedValueOnce(catalogResponse([])); // refresh shows nothing loaded

    await service.loadModel('b-model');

    expect(service.lifecyclePhase()).toBe('idle');
    const error = service.lifecycleError();
    expect(error?.message).toContain('a-model');
    expect(error?.message).toContain('b-model');
    const guidance = (error?.guidance ?? []).join('\n').toLowerCase();
    expect(guidance).toContain('no model is currently loaded');
    // The old model's local flag was cleared so the UI stays accurate.
    expect(service.models().find((m) => m.id === 'a-model')?.loaded).toBe(false);
  });

  it('sets a lifecycle error and refreshes when an unload fails', async () => {
    service.models.set([{ id: 'a-model', capabilities: ['chat'], loaded: true }]);
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' })); // unload fails
    fetchMock.mockResolvedValueOnce(catalogResponse(['a-model'])); // refresh

    await service.unloadModel();

    expect(service.lifecyclePhase()).toBe('idle');
    expect(service.lifecycleError()?.kind).toBe('network');
  });

  it('is a no-op when nothing is loaded and unloadModel is called without an id', async () => {
    service.models.set([{ id: 'a-model', capabilities: ['chat'], loaded: false }]);

    await service.unloadModel();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks lifecycle changes while a chat generation is active', async () => {
    service.models.set([
      { id: 'a-model', capabilities: ['chat'], loaded: true },
      { id: 'b-model', capabilities: ['chat'], loaded: false },
    ]);
    service.setGenerating(true);

    await service.loadModel('b-model');
    await service.unloadModel();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(service.lifecyclePhase()).toBe('idle');
  });

  it('blocks a second lifecycle operation while one is in flight', async () => {
    const first = deferredFetch();
    fetchMock.mockReturnValueOnce(first.promise); // unload hangs
    service.models.set([
      { id: 'a-model', capabilities: ['chat'], loaded: true },
      { id: 'b-model', capabilities: ['chat'], loaded: false },
    ]);

    const run1 = service.loadModel('b-model');
    expect(service.lifecyclePhase()).toBe('unloading');

    // A second load must be ignored while the first is in flight.
    await service.loadModel('a-model');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    first.resolve(jsonResponse({}));
    fetchMock.mockResolvedValueOnce(jsonResponse({ model: 'b-model' }));
    fetchMock.mockResolvedValueOnce(catalogResponse(['b-model']));
    await run1;

    expect(service.lifecyclePhase()).toBe('idle');
  });

  it('exposes elapsed time for the in-flight operation', async () => {
    vi.useFakeTimers();
    try {
      const first = deferredFetch();
      fetchMock.mockReturnValueOnce(first.promise); // load hangs
      service.models.set([{ id: 'b-model', capabilities: ['chat'], loaded: false }]);

      const run = service.loadModel('b-model');
      expect(service.lifecyclePhase()).toBe('loading');
      expect(service.loadingModelId()).toBe('b-model');
      expect(service.lifecycleElapsedMs()).toBeGreaterThanOrEqual(0);

      // Advance past three 1-second ticks so elapsed time moves forward.
      vi.advanceTimersByTime(3500);
      expect(service.lifecycleElapsedMs()).toBeGreaterThanOrEqual(2499);

      first.resolve(jsonResponse({ model: 'b-model' }));
      fetchMock.mockResolvedValueOnce(catalogResponse(['b-model']));
      await run;
      expect(service.lifecyclePhase()).toBe('idle');
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the applied config and lifecycle state when the server changes', async () => {
    service.lastAppliedConfig.set({ modelId: 'a-model', settings: {}, at: Date.now() });
    service.lifecycleError.set({ kind: 'http', message: 'boom', guidance: [] });

    service.reset();

    expect(service.lastAppliedConfig()).toBeNull();
    expect(service.lifecycleError()).toBeNull();
    expect(service.lifecyclePhase()).toBe('idle');
  });
});
