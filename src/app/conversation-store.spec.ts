import { TestBed } from '@angular/core/testing';
import { ConversationStore, deriveTitle, Message } from './conversation-store';

describe('ConversationStore', () => {
  let store: ConversationStore;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    store = TestBed.inject(ConversationStore);
  });

  it('starts empty with no selection', () => {
    expect(store.conversations().length).toBe(0);
    expect(store.selectedId()).toBeNull();
  });

  it('creates a conversation and selects it', () => {
    const created = store.create();
    expect(store.conversations().length).toBe(1);
    expect(store.selectedId()).toBe(created.id);
    expect(created.title).toBe('New conversation');
    expect(created.messages.length).toBe(0);
  });

  it('keeps conversations isolated', () => {
    const a = store.create();
    const b = store.create();
    store.appendUserMessage(a.id, 'hello A');
    store.appendUserMessage(b.id, 'hello B');
    expect(store.get(a.id)?.messages.length).toBe(1);
    expect(store.get(b.id)?.messages.length).toBe(1);
    expect(store.get(a.id)?.title).not.toBe(store.get(b.id)?.title);
  });

  it('derives the title from the first user message only', () => {
    const c = store.create();
    store.appendUserMessage(c.id, 'first question');
    store.appendUserMessage(c.id, 'second question');
    expect(store.get(c.id)?.title).toBe('first question');
  });

  it('ignores blank user messages', () => {
    const c = store.create();
    expect(store.appendUserMessage(c.id, '   ')).toBeNull();
    expect(store.get(c.id)?.messages.length).toBe(0);
  });

  it('renames a conversation and ignores blank titles', () => {
    const c = store.create();
    store.rename(c.id, 'My topic');
    expect(store.get(c.id)?.title).toBe('My topic');
    store.rename(c.id, '   ');
    expect(store.get(c.id)?.title).toBe('My topic');
  });

  it('stores the system prompt per conversation', () => {
    const a = store.create();
    const b = store.create();
    store.setSystemPrompt(a.id, 'be concise');
    expect(store.get(a.id)?.systemPrompt).toBe('be concise');
    expect(store.get(b.id)?.systemPrompt).toBe('');
  });

  it('deletes a conversation and re-selects the next one', () => {
    const a = store.create();
    const b = store.create(); // selected now
    store.select(a.id);
    store.delete(a.id);
    expect(store.conversations().length).toBe(1);
    expect(store.selectedId()).toBe(b.id);

    store.delete(b.id);
    expect(store.selectedId()).toBeNull();
  });

  it('marks non-empty conversations correctly', () => {
    const c = store.create();
    expect(store.isNonEmpty(c.id)).toBe(false);
    store.appendUserMessage(c.id, 'hi');
    expect(store.isNonEmpty(c.id)).toBe(true);
  });

  describe('assistant message lifecycle (chat states)', () => {
    it('creates a sending placeholder and streams text into it', () => {
      const c = store.create();
      const reply = store.beginAssistantReply(c.id);
      expect(reply).not.toBeNull();
      expect(store.get(c.id)?.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'sending' });

      store.updateAssistantText(c.id, reply!.id, 'Hel');
      store.updateAssistantText(c.id, reply!.id, 'Hello');
      const message = store.get(c.id)?.messages.find((m) => m.id === reply!.id);
      expect(message?.text).toBe('Hello');
    });

    it('accumulates reasoning text separately from visible text', () => {
      const c = store.create();
      const reply = store.beginAssistantReply(c.id)!;
      store.appendReasoning(c.id, reply.id, 'thinking… ');
      store.appendReasoning(c.id, reply.id, 'done.');
      const message = store.get(c.id)?.messages.find((m) => m.id === reply.id);
      expect(message?.reasoning).toBe('thinking… done.');
      expect(message?.text).toBe('');
    });

    it('completes a message with aggregated stats and clears prior errors', () => {
      const c = store.create();
      const reply = store.beginAssistantReply(c.id)!;
      store.failAssistant(c.id, reply.id, 'boom');
      expect(store.get(c.id)?.messages.find((m) => m.id === reply.id)?.status).toBe('failed');

      store.completeAssistant(c.id, reply.id, {
        text: 'final answer',
        usage: { promptTokens: 10, completionTokens: 5 },
        stats: { tokensPerSecond: 42.5, timeToFirstTokenMs: 156, generationTimeMs: 536 },
        modelId: 'model-x',
      });
      const message = store.get(c.id)?.messages.find((m) => m.id === reply.id);
      expect(message).toMatchObject({ status: 'completed', text: 'final answer', modelId: 'model-x' });
      expect(message?.error).toBeUndefined();
      expect(message?.stats?.tokensPerSecond).toBe(42.5);
    });

    it('marks a stopped message completed with partial text kept', () => {
      const c = store.create();
      const reply = store.beginAssistantReply(c.id)!;
      store.updateAssistantText(c.id, reply.id, 'partial ');
      store.stopAssistant(c.id, reply.id);
      const message = store.get(c.id)?.messages.find((m) => m.id === reply.id);
      expect(message).toMatchObject({ status: 'completed', stopped: true, text: 'partial ' });
    });

    it('stores token-free error guidance on failed messages', () => {
      const c = store.create();
      const reply = store.beginAssistantReply(c.id)!;
      store.failAssistant(c.id, reply.id, 'Could not reach the server.', ['Check that LM Studio is running.']);
      const message = store.get(c.id)?.messages.find((m) => m.id === reply.id);
      expect(message?.status).toBe('failed');
      expect(message?.error).toContain('server');
      expect(message?.guidance).toEqual(['Check that LM Studio is running.']);
    });

    it('leaves other messages untouched when patching one', () => {
      const c = store.create();
      store.appendUserMessage(c.id, 'question');
      const reply = store.beginAssistantReply(c.id)!;
      store.updateAssistantText(c.id, reply.id, 'answer');

      const [userMsg, assistantMsg] = store.get(c.id)!.messages as Message[];
      expect(userMsg.text).toBe('question');
      expect(assistantMsg.text).toBe('answer');
    });
  });

  describe('message operations (Phase 8)', () => {
    it('updates a user message and rejects blank edits', () => {
      const c = store.create();
      const user = store.appendUserMessage(c.id, 'original')!;

      expect(store.updateUserMessage(c.id, user.id, 'revised')).toBe(true);
      expect(store.get(c.id)?.messages[0].text).toBe('revised');

      // Blank edits are rejected — the text is unchanged.
      expect(store.updateUserMessage(c.id, user.id, '   ')).toBe(false);
      expect(store.get(c.id)?.messages[0].text).toBe('revised');
    });

    it('refuses to edit assistant messages', () => {
      const c = store.create();
      const reply = store.beginAssistantReply(c.id)!;
      store.updateAssistantText(c.id, reply.id, 'answer');

      expect(store.updateUserMessage(c.id, reply.id, 'hacked')).toBe(false);
      expect(store.get(c.id)?.messages[0].text).toBe('answer');
    });

    it('deletes a single message without touching the others', () => {
      const c = store.create();
      const user = store.appendUserMessage(c.id, 'q1')!;
      const reply = store.beginAssistantReply(c.id)!;
      store.updateAssistantText(c.id, reply.id, 'a1');

      store.deleteMessage(c.id, user.id);
      expect(store.get(c.id)?.messages).toHaveLength(1);
      expect(store.get(c.id)!.messages[0].id).toBe(reply.id);
    });

    it('removes every message after the given one (edit discards dependent responses)', () => {
      const c = store.create();
      const firstUser = store.appendUserMessage(c.id, 'q1')!;
      const reply1 = store.beginAssistantReply(c.id)!;
      store.updateAssistantText(c.id, reply1.id, 'a1');
      store.appendUserMessage(c.id, 'q2');
      const reply2 = store.beginAssistantReply(c.id)!;
      store.updateAssistantText(c.id, reply2.id, 'a2');

      // Edit q1: everything after it (a1, q2, a2) is discarded.
      store.removeMessagesAfter(c.id, firstUser.id);
      const messages = store.get(c.id)!.messages;
      expect(messages.map((m) => m.text)).toEqual(['q1']);

      // Removing "after" the last message keeps everything.
      store.appendUserMessage(c.id, 'q3');
      store.removeMessagesAfter(c.id, store.get(c.id)!.messages[1].id);
      expect(store.get(c.id)!.messages.map((m) => m.text)).toEqual(['q1', 'q3']);

      // Unknown ids are a no-op.
      store.removeMessagesAfter(c.id, 'does-not-exist');
      expect(store.get(c.id)!.messages).toHaveLength(2);
    });

    it('clears all messages but keeps the conversation itself', () => {
      const c = store.create();
      store.appendUserMessage(c.id, 'q1');
      store.setSystemPrompt(c.id, 'be concise');

      store.clearMessages(c.id);
      const remaining = store.get(c.id);
      expect(remaining?.messages).toEqual([]);
      // The conversation survives with its title and system prompt.
      expect(remaining?.title).toBe('q1');
      expect(remaining?.systemPrompt).toBe('be concise');
    });
  });

  describe('deriveTitle', () => {
    it('collapses whitespace and trims', () => {
      expect(deriveTitle('  hello   world  ')).toBe('hello world');
    });

    it('truncates long titles with an ellipsis', () => {
      const long = 'a'.repeat(60);
      const title = deriveTitle(long);
      expect(title.length).toBeLessThanOrEqual(41);
      expect(title.endsWith('…')).toBe(true);
    });

    it('falls back to the default for blank input', () => {
      expect(deriveTitle('   ')).toBe('New conversation');
    });
  });
});
