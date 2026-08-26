import { ConnectionStore } from './connection.store';
import { ConversationStore } from './conversation.store';
import { ModelLifecycleStore } from './model-lifecycle.store';
import { ChatSessionStore } from './chat-session.store';
import { SettingsStore } from './settings.store';
import { ChatGenerationService } from './chat-generation.service';
import { createFetchMock, GatedSseBody, waitFor } from './testing/fetch-mock';

describe('ChatGenerationService', () => {
  let service: ChatGenerationService;
  let conversations: ConversationStore;
  let connections: ConnectionStore;
  let lifecycle: ModelLifecycleStore;
  let session: ChatSessionStore;
  let settings: SettingsStore;
  let mock: ReturnType<typeof createFetchMock>;

  function createStores() {
    conversations = new ConversationStore();
    connections = new ConnectionStore();
    session = new ChatSessionStore();
    lifecycle = new ModelLifecycleStore(connections, session);
    settings = new SettingsStore();
    service = new ChatGenerationService(conversations, connections, lifecycle, session, settings);
  }

  beforeEach(async () => {
    createStores();
    mock = createFetchMock();
    vi.stubGlobal('fetch', mock.fn);
    // Start connected with a model loaded.
    mock.setResponder(() => new Response(JSON.stringify({
      data: [{ id: 'm/test', name: 'Test Model', loaded: true }],
      loaded_model_id: 'm/test'
    }), { status: 200 }));
    // Await testConnection so the stores are properly initialised before each test.
    await connections.testConnection();
    // Reset calls so tests only see their own fetch calls.
    mock.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createConversation() {
    const conv = conversations.createConversation();
    conversations.setSystemPrompt(conv.id, 'You are a helpful assistant.');
    return conv;
  }

  describe('send()', () => {
    it('appends the user message, streams content, and finalizes as completed', async () => {
      const conv = createConversation();
      mock.setResponder(() => new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n'));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      ));

      const msg = await service.send(conv.id, 'Say hello');

      expect(msg).toBeTruthy();
      expect(msg!.content).toBe('Hello');
      expect(msg!.status).toBe('completed');
      expect(session.isGenerating()).toBe(false);
    });

    it('sends the complete in-memory history including system prompt in the request body', async () => {
      const conv = createConversation();
      conversations.addMessage(conv.id, { role: 'user', content: 'Q1', status: 'completed' });
      conversations.addMessage(conv.id, { role: 'assistant', content: 'A1', status: 'completed' });

      mock.setResponder(() => new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      ));

      await service.send(conv.id, 'Q2');

      expect(mock.calls).toHaveLength(1);
      const body = JSON.parse(mock.calls[0].body ?? '{}');
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' },
        { role: 'user', content: 'Q2' }
      ]);
    });

    it('rejects sending when no model is loaded', async () => {
      connections.reset();
      const conv = conversations.createConversation();
      const msg = await service.send(conv.id, 'Hello');
      expect(msg).toBeNull();
      expect(mock.calls).toHaveLength(0);
    });

    it('rejects sending while another generation is in flight', async () => {
      const conv = createConversation();
      // Start a stream that never completes.
      const gated = new GatedSseBody();
      mock.setResponder(() => new Response(gated.stream, { status: 200 }));

      // Kick off the first send.
      const firstPromise = service.send(conv.id, 'First');
      // Wait for the stream to start (fetch call made).
      await waitFor(() => mock.calls.some((c) => c.url.includes('chat/completions')));

      // Second send should be rejected immediately.
      const guard = service.canSend();
      expect(guard.ok).toBe(false);
      expect(guard.reason).toContain('already being generated');

      // Complete the first stream.
      gated.push('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n');
      gated.close();
      await firstPromise;
    });

    it('rejects sending with empty content', async () => {
      const conv = createConversation();
      expect(await service.send(conv.id, '   ')).toBeNull();
      expect(await service.send(conv.id, '')).toBeNull();
    });
  });

  describe('cancellation → cancelled status with partial content', () => {
    it('marks the message as cancelled when the user stops mid-stream with content', async () => {
      const conv = createConversation();
      let gated: GatedSseBody | undefined;
      mock.setResponder((call) => {
        // Pass the fetch signal to GatedSseBody so abort propagates to the stream.
        gated = new GatedSseBody(call.signal);
        return new Response(gated!.stream, { status: 200 });
      });

      const sendPromise = service.send(conv.id, 'Write a long response');
      // Wait for the stream to start (GatedSseBody is created and pull is pending).
      await waitFor(() => !!gated && gated!.pendingReads > 0);
      // Deliver partial content.
      gated!.push('data: {"choices":[{"delta":{"content":"Partial "}}]}\n\n');
      // Wait for the content to be delivered to the conversation store before canceling.
      await waitFor(() => {
        const msgs = conversations.conversations().find(c => c.id === conv.id)?.messages ?? [];
        return msgs.some(m => m.role === 'assistant' && m.content.includes('Partial'));
      });
      // Now cancel — the abort signal propagates to GatedSseBody which errors the stream.
      service.cancel();
      // Explicitly fail the stream to ensure the error propagates through GatedSseBody.
      gated!.fail(new DOMException('Aborted', 'AbortError'));

      const msg = await sendPromise;
      expect(msg!.status).toBe('cancelled');
      expect(msg!.content).toContain('Partial ');
      expect(session.isGenerating()).toBe(false);
    });

    it('marks the message as failed when cancelled with no content', async () => {
      const conv = createConversation();
      const gated = new GatedSseBody();
      mock.setResponder(() => new Response(gated.stream, { status: 200 }));

      const sendPromise = service.send(conv.id, 'Something');
      await waitFor(() => gated.pendingReads > 0);
      service.cancel();

      const msg = await sendPromise;
      expect(msg!.status).toBe('failed');
      expect(msg!.content).toBe('');
    });

    it('marks the message as cancelled when stopped mid-reasoning (no content yet)', async () => {
      const conv = createConversation();
      const gated = new GatedSseBody();
      mock.setResponder(() => new Response(gated.stream, { status: 200 }));

      const sendPromise = service.send(conv.id, 'Think hard');
      await waitFor(() => gated.pendingReads > 0);
      // Deliver a reasoning delta only — no visible content yet.
      gated.push('data: {"choices":[{"delta":{"reasoning_content":"Let me think…"}}]}\n\n');
      await waitFor(() => {
        const msgs = conversations.conversations().find(c => c.id === conv.id)?.messages ?? [];
        return msgs.some(m => m.role === 'assistant' && (m.reasoning ?? '').includes('Let me think'));
      });
      service.cancel();

      const msg = await sendPromise;
      expect(msg!.status).toBe('cancelled');
      expect(msg!.content).toBe('');
      expect(msg!.reasoning).toContain('Let me think');
    });
  });

  describe('regenerateLatest()', () => {
    it('drops the latest assistant message and resends full history', async () => {
      const conv = createConversation();
      conversations.addMessage(conv.id, { role: 'user', content: 'Q', status: 'completed' });
      const oldAssistant = conversations.addMessage(conv.id, { role: 'assistant', content: 'Old A', status: 'completed' });

      mock.setResponder(() => new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"New A"}}]}\n\n'));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      ));

      const newMsg = await service.regenerateLatest(conv.id);
      expect(newMsg!.content).toBe('New A');
      // Old assistant message should be gone.
      expect(conversations.findMessage(conv.id, oldAssistant!.id)).toBeUndefined();
    });

    it('returns null when there is no assistant message to regenerate', async () => {
      const conv = createConversation();
      conversations.addMessage(conv.id, { role: 'user', content: 'Q', status: 'completed' });
      expect(await service.regenerateLatest(conv.id)).toBeNull();
    });
  });

  describe('editAndRegenerate()', () => {
    it('edits the user message, truncates dependent responses, and resends history', async () => {
      const conv = createConversation();
      const u1 = conversations.addMessage(conv.id, { role: 'user', content: 'Original Q', status: 'completed' });
      const a1 = conversations.addMessage(conv.id, { role: 'assistant', content: 'Old A', status: 'completed' });
      const u2 = conversations.addMessage(conv.id, { role: 'user', content: 'Follow-up', status: 'completed' });

      mock.setResponder(() => new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"Revised A"}}]}\n\n'));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      ));

      const newMsg = await service.editAndRegenerate(conv.id, u1!.id, 'Revised Q');
      expect(newMsg!.content).toBe('Revised A');

      // a1 and u2 should be gone (truncated).
      expect(conversations.findMessage(conv.id, a1!.id)).toBeUndefined();
      expect(conversations.findMessage(conv.id, u2!.id)).toBeUndefined();

      // The request history should reflect the edited user message.
      const body = JSON.parse(mock.calls[0].body ?? '{}');
      expect(body.messages).toEqual([
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Revised Q' }
      ]);
    });

    it('returns null when the message id is not found', async () => {
      const conv = createConversation();
      expect(await service.editAndRegenerate(conv.id, 'nonexistent', 'new content')).toBeNull();
    });
  });

  describe('isActive signal', () => {
    it('reflects the session.isGenerating state', async () => {
      const conv = createConversation();
      expect(service.isActive()).toBe(false);

      mock.setResponder(() => new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
            controller.enqueue(enc.encode('data: [DONE]\n\n'));
            controller.close();
          }
        }),
        { status: 200 }
      ));

      void service.send(conv.id, 'Hello');
      expect(service.isActive()).toBe(true);
      await waitFor(() => !service.isActive());
      expect(service.isActive()).toBe(false);
    });
  });

  describe('buildMetrics', () => {
    it('computes timeToFirstTokenMs and tokensPerSecond from turn state', () => {
      const base = Date.now() - 500;
      const metrics = service.buildMetrics(base, 1000, {
        content: 'test',
        reasoning: '',
        usage: { promptTokens: 10, completionTokens: 5 },
        firstContentAtMs: base + 200
      });
      expect(metrics.timeToFirstTokenMs).toBe(200);
      expect(metrics.inputTokens).toBe(10);
      expect(metrics.outputTokens).toBe(5);
      // 5 tokens / 0.8s = 6.25 tok/s
      expect(metrics.tokensPerSecond).toBe(6.25);
      expect(metrics.totalElapsedMs).toBe(1000);
    });

    it('includes modelLoadTimeMs when measured during this session', () => {
      lifecycle.lastLoadDurationMs.set(3000);
      const metrics = service.buildMetrics(Date.now(), 500, {
        content: 'x',
        reasoning: '',
        usage: { completionTokens: 2 },
        firstContentAtMs: Date.now()
      });
      expect(metrics.modelLoadTimeMs).toBe(3000);
    });

    it('includes the model instance identifier when the server reported one', () => {
      lifecycle.lastInstanceId.set('qwen/qwen3.8-27b');
      const metrics = service.buildMetrics(Date.now(), 500, {
        content: 'x',
        reasoning: '',
        usage: { completionTokens: 2 },
        firstContentAtMs: Date.now()
      });
      expect(metrics.instanceId).toBe('qwen/qwen3.8-27b');

      // No instance id → the field is simply absent.
      lifecycle.lastInstanceId.set(null);
      const empty = service.buildMetrics(Date.now(), 500, {
        content: 'x',
        reasoning: '',
        usage: { completionTokens: 2 },
        firstContentAtMs: Date.now()
      });
      expect(empty.instanceId).toBeUndefined();
    });
  });

  describe('silent-stream watchdog', () => {
    it('surfaces a waiting notice and fails a stream that stays silent, releasing the lock', async () => {
      const originalWarn = ChatGenerationService.silentWarnMs;
      const originalTimeout = ChatGenerationService.silentTimeoutMs;
      ChatGenerationService.silentWarnMs = 5_000;
      ChatGenerationService.silentTimeoutMs = 10_000;
      vi.useFakeTimers();
      try {
        const conv = createConversation();
        const gated = new GatedSseBody();
        mock.setResponder(() => new Response(gated.stream, { status: 200 }));

        const sendPromise = service.send(conv.id, 'Hello');
        // The chat request fires synchronously; the stream read is now pending.
        expect(mock.calls.some((c) => c.url.includes('chat/completions'))).toBe(true);

        // Past the warn threshold the UI shows a "waiting" notice.
        await vi.advanceTimersByTimeAsync(6_000);
        expect(service.phase()).toContain('Waiting for the model');

        // Past the hard timeout the turn fails and the lock is released.
        await vi.advanceTimersByTimeAsync(6_000);
        const msg = await sendPromise;
        expect(msg!.status).toBe('failed');
        expect(msg!.error).toContain('stayed silent');
        expect(session.isGenerating()).toBe(false);
        expect(service.phase()).toBeNull();
      } finally {
        vi.useRealTimers();
        ChatGenerationService.silentWarnMs = originalWarn;
        ChatGenerationService.silentTimeoutMs = originalTimeout;
      }
    });

    it('does not fail a stream that delivers data before the timeout', async () => {
      const originalWarn = ChatGenerationService.silentWarnMs;
      const originalTimeout = ChatGenerationService.silentTimeoutMs;
      ChatGenerationService.silentWarnMs = 5_000;
      ChatGenerationService.silentTimeoutMs = 10_000;
      vi.useFakeTimers();
      try {
        const conv = createConversation();
        const gated = new GatedSseBody();
        mock.setResponder(() => new Response(gated.stream, { status: 200 }));

        const sendPromise = service.send(conv.id, 'Hello');
        // Wait past the warn threshold (but not the timeout), then deliver data.
        await vi.advanceTimersByTimeAsync(6_000);
        gated.push('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n');
        gated.close();

        const msg = await sendPromise;
        expect(msg!.status).toBe('completed');
        expect(msg!.content).toBe('Hi');
        expect(session.isGenerating()).toBe(false);
      } finally {
        vi.useRealTimers();
        ChatGenerationService.silentWarnMs = originalWarn;
        ChatGenerationService.silentTimeoutMs = originalTimeout;
      }
    });
  });
});
