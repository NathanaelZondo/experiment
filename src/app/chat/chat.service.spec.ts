import { TestBed } from '@angular/core/testing';
import { ConversationStore } from '../conversation-store';
import { LmStudioService } from '../lmstudio/lm-studio.service';
import { ChatService } from './chat.service';
import { GenerationSettingsService } from './generation-settings';

/** A stream we can feed and close manually, so tests control timing. */
function controllableStream(): { response: Response; push: (s: string) => void; close: () => void; error: (e: unknown) => void } {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    push: (s) => controller.enqueue(encoder.encode(s)),
    close: () => controller.close(),
    error: (e) => controller.error(e),
  };
}

function deltaFrame(content?: string, reasoning?: string): string {
  const delta: Record<string, unknown> = {};
  if (content !== undefined) {
    delta['content'] = content;
  }
  if (reasoning !== undefined) {
    delta['reasoning_content'] = reasoning;
  }
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta }] })}\n\n`;
}

function finishFrame(): string {
  return `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], stats: { tokens_per_second: 42 } })}\n\ndata: [DONE]\n\n`;
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ChatService', () => {
  let store: ConversationStore;
  let lm: LmStudioService;
  let chat: ChatService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ConversationStore);
    lm = TestBed.inject(LmStudioService);
    chat = TestBed.inject(ChatService);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function loadModel(): void {
    lm.models.set([{ id: 'model-x', capabilities: ['chat'], loaded: true }]);
  }

  it('refuses to send when no model is loaded and shows the hint', () => {
    const c = store.create();
    chat.send(c.id, 'hello');

    expect(chat.noModelHint()).toBe(true);
    expect(store.get(c.id)?.messages.length).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appends the user message and a sending placeholder, then completes with streamed text', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick(); // Let the request start and the reader attach.

    expect(store.get(c.id)?.messages.length).toBe(2);
    expect(chat.generating()).toBe(true);
    expect(lm.generating()).toBe(true); // Load/unload blocked while generating.

    stream.push(deltaFrame('Hel'));
    await tick();
    stream.push(deltaFrame('lo!'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    const messages = store.get(c.id)!.messages;
    expect(messages[0]).toMatchObject({ role: 'user', text: 'hello' });
    expect(messages[1]).toMatchObject({ role: 'assistant', status: 'completed', text: 'Hello!', modelId: 'model-x' });
    expect((messages[1] as { stats?: { tokensPerSecond?: number } }).stats?.tokensPerSecond).toBe(42);
    expect(chat.generating()).toBe(false);
    expect(lm.generating()).toBe(false);
  });

  it('sends the system prompt and full history for multi-turn conversations', async () => {
    loadModel();
    const c = store.create();
    store.setSystemPrompt(c.id, 'be concise');

    // Turn one.
    let stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    chat.send(c.id, 'first question');
    await tick();
    stream.push(deltaFrame('A1'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    // Turn two — the request must include system prompt + prior exchange.
    stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    chat.send(c.id, 'second question');
    await tick();
    stream.push(deltaFrame('A2'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody.messages).toEqual([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'first question' },
      { role: 'assistant', content: 'A1' },
      { role: 'user', content: 'second question' },
    ]);
  });

  it('ignores a second send while one is in flight (concurrency protection)', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'first');
    await tick();
    chat.send(c.id, 'second'); // Must be ignored.

    expect(store.get(c.id)?.messages.length).toBe(2); // Only the first exchange exists.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    stream.push(deltaFrame('done'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();
  });

  it('keeps partial text when generation is stopped', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    stream.push(deltaFrame('partial answer'));
    await tick();

    chat.stop();
    // In a real browser the aborted signal makes the body read reject; here we
    // close the stream to let the reader loop (and cleanup) settle.
    stream.close();
    await tick();
    await tick();

    const reply = store.get(c.id)!.messages[1];
    expect(reply.status).toBe('completed');
    expect(reply.stopped).toBe(true);
    expect(reply.text).toBe('partial answer'); // Partial response kept.
    expect(chat.generating()).toBe(false);
  });

  it('marks the message failed with guidance when the request fails', async () => {
    loadModel();
    const c = store.create();
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'TypeError' }));

    chat.send(c.id, 'hello');
    await tick();
    await tick();

    const reply = store.get(c.id)!.messages[1];
    expect(reply.status).toBe('failed');
    expect(reply.error).toContain('LM Studio server');
    expect((reply.guidance ?? []).join('\n').toLowerCase()).toContain('cross-origin');
  });

  it('marks the message failed on an in-band error frame', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    stream.push(deltaFrame('some text'));
    stream.push(`data: ${JSON.stringify({ error: { message: 'context length exceeded' } })}\n\n`);
    stream.close();
    await tick();
    await tick();

    const reply = store.get(c.id)!.messages[1];
    expect(reply.status).toBe('failed');
    expect(reply.error).toBe('context length exceeded');
  });

  it('recovers from a stream that ends without a finish frame, keeping partial text', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    stream.push(deltaFrame('interrupted'));
    stream.close(); // No finish frame, no [DONE] — interrupted tail.
    await tick();
    await tick();

    const reply = store.get(c.id)!.messages[1];
    expect(reply.status).toBe('completed');
    expect(reply.text).toBe('interrupted');
  });

  it('marks the message failed when an empty stream ends without any content', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    stream.close(); // Nothing at all.
    await tick();
    await tick();

    const reply = store.get(c.id)!.messages[1];
    expect(reply.status).toBe('failed');
    expect(reply.error).toContain('ended unexpectedly');
  });

  it('accumulates reasoning text separately from visible text', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    stream.push(deltaFrame(undefined, 'thinking…'));
    stream.push(deltaFrame('answer'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    const reply = store.get(c.id)!.messages[1];
    expect(reply.text).toBe('answer');
    expect(requestBody(0)).toBeDefined(); // sanity: the request was made
    expect(reply.reasoning).toBe('thinking…');
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper for raw request bodies.
  function requestBody(index: number): any {
    return JSON.parse(fetchMock.mock.calls[index][1].body);
  }

  it('applies the generation settings to every request', async () => {
    loadModel();
    const gen = TestBed.inject(GenerationSettingsService);
    gen.update({ temperature: 1.5, reasoningMode: 'low' });

    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    stream.push(deltaFrame('ok'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    const body = requestBody(0);
    expect(body.temperature).toBe(1.5);
    expect(body.top_p).toBe(1); // default kept
    expect(body.max_tokens).toBe(2048); // default kept
    expect(body.reasoning_effort).toBe('low');
  });

  it('regenerates the latest response from the remaining history', async () => {
    loadModel();
    const c = store.create();
    store.setSystemPrompt(c.id, 'be concise');

    // Turn one completes.
    let stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    chat.send(c.id, 'first question');
    await tick();
    stream.push(deltaFrame('A1'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    // Regenerate: the old reply is removed and a fresh one streams in.
    const regenerated = controllableStream();
    fetchMock.mockResolvedValueOnce(regenerated.response);
    chat.regenerateLatest(c.id);
    await tick();

    expect(store.get(c.id)!.messages.map((m) => m.text)).toEqual(['first question', '']); // old A1 gone, placeholder in place.
    const body = requestBody(1);
    // The resent history excludes the discarded reply.
    expect(body.messages).toEqual([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'first question' },
    ]);

    regenerated.push(deltaFrame('A1-new'));
    regenerated.push(finishFrame());
    regenerated.close();
    await tick();
    await tick();

    const last = store.get(c.id)!.messages.at(-1);
    expect(last).toMatchObject({ role: 'assistant', status: 'completed', text: 'A1-new' });
  });

  it('generates the missing reply when the conversation ends on a user message', async () => {
    loadModel();
    const c = store.create();
    store.appendUserMessage(c.id, 'orphan question'); // Never received a reply.

    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    chat.regenerateLatest(c.id);
    await tick();

    expect(store.get(c.id)!.messages).toHaveLength(2);
    expect(store.get(c.id)!.messages[1].status).toBe('sending');

    stream.push(deltaFrame('finally'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    expect(store.get(c.id)!.messages.at(-1)).toMatchObject({ status: 'completed', text: 'finally' });
  });

  it('edits a user message, discards dependent responses and resends the revised history', async () => {
    loadModel();
    const c = store.create();
    store.setSystemPrompt(c.id, 'be concise');

    // Two completed turns: [u1, a1, u2, a2].
    let stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    chat.send(c.id, 'first question');
    await tick();
    stream.push(deltaFrame('A1'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);
    chat.send(c.id, 'second question');
    await tick();
    stream.push(deltaFrame('A2'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    const firstUser = store.get(c.id)!.messages[0];
    expect(store.get(c.id)!.messages.map((m) => m.text)).toEqual(['first question', 'A1', 'second question', 'A2']);

    // Edit the FIRST message: everything after it is discarded and a fresh
    // reply streams from the revised history.
    const regenerated = controllableStream();
    fetchMock.mockResolvedValueOnce(regenerated.response);
    chat.editAndRegenerate(c.id, firstUser.id, 'first question (edited)');
    await tick();

    // Dependent responses are gone; only the edited message + new placeholder remain.
    expect(store.get(c.id)!.messages.map((m) => m.text)).toEqual(['first question (edited)', '']);

    const body = requestBody(2);
    expect(body.messages).toEqual([
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'first question (edited)' },
    ]);

    regenerated.push(deltaFrame('A1-edited'));
    regenerated.push(finishFrame());
    regenerated.close();
    await tick();
    await tick();

    const last = store.get(c.id)!.messages.at(-1);
    expect(last).toMatchObject({ status: 'completed', text: 'A1-edited' });
  });

  it('applies an edit and discards dependents even when no model is loaded', () => {
    // No loadModel() on purpose.
    const c = store.create();
    const firstUser = store.appendUserMessage(c.id, 'q1')!;
    const reply = store.beginAssistantReply(c.id)!;
    store.updateAssistantText(c.id, reply.id, 'a1');

    chat.editAndRegenerate(c.id, firstUser.id, 'q1 edited');

    expect(chat.noModelHint()).toBe(true);
    // The edit landed and the dependent response was discarded.
    expect(store.get(c.id)!.messages.map((m) => m.text)).toEqual(['q1 edited']);
  });

  it('ignores regenerate while another generation is in flight', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    chat.regenerateLatest(c.id); // Must be ignored.

    expect(store.get(c.id)!.messages).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    stream.push(deltaFrame('done'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();
  });

  it('deletes a single message and refuses to delete the in-flight one', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    const [userMsg, reply] = store.get(c.id)!.messages;

    // The in-flight message cannot be deleted.
    chat.deleteMessage(c.id, reply.id);
    expect(store.get(c.id)!.messages).toHaveLength(2);

    // Let it finish, then delete the completed reply.
    stream.push(deltaFrame('answer'));
    stream.push(finishFrame());
    stream.close();
    await tick();
    await tick();

    chat.deleteMessage(c.id, reply.id);
    expect(store.get(c.id)!.messages.map((m) => m.text)).toEqual(['hello']);
    // The user message is untouched.
    expect(store.get(c.id)!.messages[0].id).toBe(userMsg.id);
  });

  it('clears a conversation, aborting any in-flight generation it owns', async () => {
    loadModel();
    const c = store.create();
    const stream = controllableStream();
    fetchMock.mockResolvedValueOnce(stream.response);

    chat.send(c.id, 'hello');
    await tick();
    expect(chat.generating()).toBe(true);

    chat.clearConversation(c.id);
    // Messages are gone immediately; the in-flight message is marked stopped.
    expect(store.get(c.id)!.messages).toEqual([]);

    stream.close();
    await tick();
    await tick();
    expect(chat.generating()).toBe(false);
  });
});
