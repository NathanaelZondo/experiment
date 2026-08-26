import { ConnectionStore } from './connection.store';
import { createFetchMock } from './testing/fetch-mock';

const MODELS_JSON = JSON.stringify({
  data: [
    { id: 'm/loaded-1', name: 'Loaded One', loaded: true },
    { id: 'm/idle-2', name: 'Idle Two' }
  ]
});

describe('ConnectionStore', () => {
  let store: ConnectionStore;
  let mock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    store = new ConnectionStore();
    mock = createFetchMock();
    vi.stubGlobal('fetch', mock.fn);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts disconnected with the default server URL and no models', () => {
    expect(store.status()).toBe('disconnected');
    expect(store.serverUrl()).toBe('http://localhost:1234');
    expect(store.models()).toEqual([]);
    expect(store.loadedModelId).toBeNull();
  });

  it('testConnection transitions disconnected → checking → connected and stores the catalogue', async () => {
    mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
    const result = await store.testConnection();

    expect(result.ok).toBe(true);
    expect(store.status()).toBe('connected');
    expect(store.models()).toHaveLength(2);
    expect(store.loadedModelId).toBe('m/loaded-1');
    // Discovery used the native endpoint.
    expect(mock.calls[0].url).toBe('http://localhost:1234/api/v1/models');
  });

  it('testConnection transitions to failed with guidance when the server is unreachable', async () => {
    mock.setResponder(() => Promise.reject(new TypeError('Failed to fetch')));
    const result = await store.testConnection();

    expect(result.ok).toBe(false);
    expect(store.status()).toBe('failed');
    expect(store.lastError()).toContain('CORS');
    // A failed test must not leave stale models behind.
    expect(store.models()).toEqual([]);
  });

  it('never includes the API token in error messages', async () => {
    store.setApiToken('super-secret-token');
    mock.setResponder(() => Promise.reject(new TypeError('Failed to fetch')));
    await store.testConnection();
    expect(store.lastError()).not.toContain('super-secret-token');
  });

  it('setServerUrl resets the catalogue and status (different server)', async () => {
    mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
    await store.testConnection();
    expect(store.status()).toBe('connected');

    store.setServerUrl('http://192.168.1.50:1234/');
    expect(store.serverUrl()).toBe('http://192.168.1.50:1234'); // trailing slash trimmed
    expect(store.status()).toBe('disconnected');
    expect(store.models()).toEqual([]);
  });

  it('refreshModels re-fetches the catalogue while connected and is a no-op otherwise', async () => {
    mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
    await store.testConnection();
    expect(mock.calls).toHaveLength(1);

    // Simulate a model switch on the server side.
    mock.setResponder(() => new Response(JSON.stringify({ data: [{ id: 'm/idle-2', name: 'Idle Two', loaded: true }] }), { status: 200 }));
    await store.refreshModels();
    expect(mock.calls).toHaveLength(2);
    expect(store.loadedModelId).toBe('m/idle-2');

    // Not connected → no request.
    store.reset();
    await store.refreshModels();
    expect(mock.calls).toHaveLength(2);
  });

  it('refreshModels keeps the previous catalogue on a transient failure', async () => {
    mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
    await store.testConnection();
    const before = store.models();

    mock.setResponder(() => Promise.reject(new TypeError('blip')));
    await store.refreshModels(); // must not throw
    expect(store.models()).toEqual(before);
    expect(store.status()).toBe('connected');
  });

  it('reset() clears all cached state', async () => {
    mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
    await store.testConnection();
    store.reset();
    expect(store.status()).toBe('disconnected');
    expect(store.lastError()).toBeNull();
    expect(store.models()).toEqual([]);
  });

  it('config exposes the token only to the client (never in signals or errors)', () => {
    store.setApiToken('tok-123');
    expect(store.config.apiToken).toBe('tok-123');
    // The signal itself is RAM-only state; nothing persists it.
    expect(store.apiToken()).toBe('tok-123');
  });

  it('startAutoReconnect re-probes while disconnected and connects when the server returns', async () => {
    vi.useFakeTimers();
    try {
      mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
      store.startAutoReconnect(1_000);
      expect(store.status()).toBe('disconnected');

      await vi.advanceTimersByTimeAsync(1_000);
      expect(store.status()).toBe('connected');
      expect(mock.calls).toHaveLength(1);
    } finally {
      store.stopAutoReconnect();
      vi.useRealTimers();
    }
  });

  it('startAutoReconnect skips re-probing while connected', async () => {
    mock.setResponder(() => new Response(MODELS_JSON, { status: 200 }));
    await store.testConnection();
    expect(store.status()).toBe('connected');

    vi.useFakeTimers();
    try {
      store.startAutoReconnect(1_000);
      await vi.advanceTimersByTimeAsync(2_500);
      // Only the initial testConnection probe was made.
      expect(mock.calls).toHaveLength(1);
    } finally {
      store.stopAutoReconnect();
      vi.useRealTimers();
    }
  });
});
