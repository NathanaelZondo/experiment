import { ChatSessionStore } from './chat-session.store';

describe('ChatSessionStore (single-flight generation guard)', () => {
  let store: ChatSessionStore;

  beforeEach(() => {
    store = new ChatSessionStore();
  });

  it('starts idle', () => {
    expect(store.isGenerating()).toBe(false);
    expect(store.active).toBe(false);
  });

  it('beginGeneration returns an AbortController and marks the session active', () => {
    const controller = store.beginGeneration();
    expect(controller).toBeInstanceOf(AbortController);
    expect(store.isGenerating()).toBe(true);
    expect(store.active).toBe(true);
  });

  it('blocks a second concurrent generation (concurrency protection)', () => {
    store.beginGeneration();
    expect(store.beginGeneration()).toBeNull();
  });

  it('cancel() aborts the in-flight controller', () => {
    const controller = store.beginGeneration()!;
    expect(controller.signal.aborted).toBe(false);
    store.cancel();
    expect(controller.signal.aborted).toBe(true);
  });

  it('endGeneration clears the guard so a new generation can start', () => {
    store.beginGeneration();
    store.endGeneration();
    expect(store.isGenerating()).toBe(false);
    const next = store.beginGeneration();
    expect(next).toBeInstanceOf(AbortController);
  });

  it('cancel() is safe when nothing is in flight', () => {
    expect(() => store.cancel()).not.toThrow();
  });

  it('exposes pastCeiling once a generation exceeds the absolute time cap', () => {
    const original = ChatSessionStore.ceilingMs;
    ChatSessionStore.ceilingMs = 10_000;
    vi.useFakeTimers();
    try {
      store.beginGeneration();
      expect(store.pastCeiling).toBe(false);
      vi.advanceTimersByTime(10_001);
      expect(store.pastCeiling).toBe(true);
      // endGeneration resets the clock so a new generation starts fresh.
      store.endGeneration();
      expect(store.pastCeiling).toBe(false);
    } finally {
      ChatSessionStore.ceilingMs = original;
      vi.useRealTimers();
    }
  });
});
