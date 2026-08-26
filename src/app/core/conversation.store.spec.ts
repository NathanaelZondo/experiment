import { ConversationStore, DEFAULT_CONVERSATION_TITLE, deriveTitle } from './conversation.store';

describe('deriveTitle', () => {
  it('uses the first non-empty line and flattens whitespace', () => {
    expect(deriveTitle('\n\n  Why is the sky blue?  ')).toBe('Why is the sky blue?');
  });

  it('truncates long titles with an ellipsis', () => {
    const title = deriveTitle('a'.repeat(100));
    expect(title.length).toBeLessThanOrEqual(42);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to the default for empty content', () => {
    expect(deriveTitle('   ')).toBe(DEFAULT_CONVERSATION_TITLE);
  });
});

describe('ConversationStore', () => {
  let store: ConversationStore;

  beforeEach(() => {
    store = new ConversationStore();
  });

  function userMsg(content: string) {
    return { role: 'user' as const, content, status: 'completed' as const };
  }
  function assistantMsg(content: string) {
    return { role: 'assistant' as const, content, status: 'completed' as const };
  }

  describe('conversation CRUD', () => {
    it('creates a conversation with the default title and selects it', () => {
      const conv = store.createConversation();
      expect(conv.title).toBe(DEFAULT_CONVERSATION_TITLE);
      expect(store.activeId()).toBe(conv.id);
      expect(store.active()?.id).toBe(conv.id);
    });

    it('prepends new conversations to the list', () => {
      const a = store.createConversation();
      const b = store.createConversation();
      expect(store.conversations().map((c) => c.id)).toEqual([b.id, a.id]);
    });

    it('selects an existing conversation and ignores unknown ids', () => {
      const a = store.createConversation();
      const b = store.createConversation();
      store.select(a.id);
      expect(store.activeId()).toBe(a.id);
      store.select('does-not-exist');
      expect(store.activeId()).toBe(a.id);
    });

    it('renames with trimmed content and ignores blank titles', () => {
      const conv = store.createConversation();
      store.rename(conv.id, '  My model test  ');
      expect(store.conversations()[0].title).toBe('My model test');
      store.rename(conv.id, '   ');
      expect(store.conversations()[0].title).toBe('My model test');
    });

    it('deletes a conversation and moves the selection to the next one', () => {
      const a = store.createConversation();
      const b = store.createConversation(); // active
      expect(store.deleteConversation(a.id)).toBe(true);
      expect(store.conversations()).toHaveLength(1);
      expect(store.activeId()).toBe(b.id);

      expect(store.deleteConversation(b.id)).toBe(true);
      expect(store.activeId()).toBeNull();
      expect(store.deleteConversation('missing')).toBe(false);
    });

    it('keeps a per-conversation system prompt', () => {
      const conv = store.createConversation();
      store.setSystemPrompt(conv.id, 'Be terse.');
      expect(store.conversations()[0].systemPrompt).toBe('Be terse.');
    });
  });

  describe('auto-titling', () => {
    it('derives the title from the first user message only while untitled', () => {
      const conv = store.createConversation();
      store.addMessage(conv.id, userMsg('Explain transformers'));
      expect(store.conversations()[0].title).toBe('Explain transformers');

      // A later user message must not overwrite an established title.
      store.addMessage(conv.id, assistantMsg('Sure!'));
      store.addMessage(conv.id, userMsg('Second question here'));
      expect(store.conversations()[0].title).toBe('Explain transformers');
    });

    it('does not re-title a conversation that was renamed manually', () => {
      const conv = store.createConversation();
      store.rename(conv.id, 'Pinned name');
      store.addMessage(conv.id, userMsg('Something else'));
      expect(store.conversations()[0].title).toBe('Pinned name');
    });
  });

  describe('message operations', () => {
    it('adds messages with ids and timestamps', () => {
      const conv = store.createConversation();
      const msg = store.addMessage(conv.id, userMsg('Hi'));
      expect(msg?.id).toBeTruthy();
      expect(typeof msg?.createdAt).toBe('number');
      expect(store.conversations()[0].messages).toHaveLength(1);
    });

    it('patches a message via updateMessage', () => {
      const conv = store.createConversation();
      const msg = store.addMessage(conv.id, userMsg('Hi'));
      store.updateMessage(conv.id, msg!.id, { content: 'Hello' });
      expect(store.findMessage(conv.id, msg!.id)?.content).toBe('Hello');
    });

    it('returns null when adding to an unknown conversation', () => {
      expect(store.addMessage('missing', userMsg('x'))).toBeNull();
    });
  });

  describe('Phase 8 operations', () => {
    function seededConversation() {
      const conv = store.createConversation();
      const u1 = store.addMessage(conv.id, userMsg('Q1'));
      const a1 = store.addMessage(conv.id, assistantMsg('A1'));
      const u2 = store.addMessage(conv.id, userMsg('Q2'));
      const a2 = store.addMessage(conv.id, assistantMsg('A2'));
      return { conv, u1: u1!, a1: a1!, u2: u2!, a2: a2! };
    }

    it('editUserMessage replaces content and truncates dependent later messages', () => {
      const { conv, u1, a1, u2, a2 } = seededConversation();
      const removed = store.editUserMessage(conv.id, u1.id, 'Q1 edited');
      expect(removed).toBe(3); // a1, u2, a2

      const messages = store.conversations()[0].messages;
      expect(messages.map((m) => m.content)).toEqual(['Q1 edited']);
      // The remaining message is the edited user message itself.
      expect(store.findMessage(conv.id, u1.id)?.content).toBe('Q1 edited');
      expect(store.findMessage(conv.id, a1.id)).toBeUndefined();
      expect(store.findMessage(conv.id, u2.id)).toBeUndefined();
      expect(store.findMessage(conv.id, a2.id)).toBeUndefined();
    });

    it('editUserMessage on the last message removes nothing', () => {
      // Build a conversation where the user message is truly the last message.
      const conv = store.createConversation();
      const u1 = store.addMessage(conv.id, userMsg('Q1'));
      const a1 = store.addMessage(conv.id, assistantMsg('A1'));
      const uLast = store.addMessage(conv.id, userMsg('Q2'))!;
      // uLast is the last message — editing it should remove 0 dependent messages.
      expect(store.editUserMessage(conv.id, uLast.id, 'Q2 edited')).toBe(0);
      expect(store.conversations()[0].messages).toHaveLength(3);
    });

    it('editUserMessage refuses to edit assistant messages', () => {
      const { conv, a1 } = seededConversation();
      expect(store.editUserMessage(conv.id, a1.id, 'nope')).toBe(0);
      expect(store.conversations()[0].messages).toHaveLength(4);
    });

    it('deleteMessageWithDependents truncates history at the deleted message', () => {
      const { conv, u2 } = seededConversation();
      const removed = store.deleteMessageWithDependents(conv.id, u2.id);
      expect(removed).toBe(2); // u2 + a2
      expect(store.conversations()[0].messages.map((m) => m.content)).toEqual(['Q1', 'A1']);
    });

    it('removeLatestAssistantMessage drops only the most recent assistant response', () => {
      const { conv, a1 } = seededConversation();
      expect(store.removeLatestAssistantMessage(conv.id)).toBe(true);
      const contents = store.conversations()[0].messages.map((m) => m.content);
      expect(contents).toEqual(['Q1', 'A1', 'Q2']); // A2 removed

      // Second call removes A1.
      expect(store.removeLatestAssistantMessage(conv.id)).toBe(true);
      expect(store.findMessage(conv.id, a1.id)).toBeUndefined();
    });

    it('removeLatestAssistantMessage returns false when there is no assistant message', () => {
      const conv = store.createConversation();
      store.addMessage(conv.id, userMsg('only user'));
      expect(store.removeLatestAssistantMessage(conv.id)).toBe(false);
    });

    it('clearMessages empties the conversation but keeps title and system prompt', () => {
      const { conv } = seededConversation();
      store.setSystemPrompt(conv.id, 'sys');
      store.clearMessages(conv.id);
      const c = store.conversations()[0];
      expect(c.messages).toHaveLength(0);
      expect(c.systemPrompt).toBe('sys');
    });
  });

  describe('historyForRequest', () => {
    it('sends the system prompt plus every non-empty user/assistant message in order', () => {
      const conv = store.createConversation();
      store.setSystemPrompt(conv.id, 'You are terse.');
      store.addMessage(conv.id, userMsg('Q1'));
      store.addMessage(conv.id, assistantMsg('A1'));
      // An empty failed placeholder must be skipped.
      store.addMessage(conv.id, { role: 'assistant', content: '', status: 'failed' });

      expect(store.historyForRequest(conv.id)).toEqual([
        { role: 'system', content: 'You are terse.' },
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'A1' }
      ]);
    });

    it('omits the system message when no prompt is set and returns [] for unknown ids', () => {
      const conv = store.createConversation();
      store.addMessage(conv.id, userMsg('Q'));
      expect(store.historyForRequest(conv.id)).toEqual([{ role: 'user', content: 'Q' }]);
      expect(store.historyForRequest('missing')).toEqual([]);
    });

    it('includes partial cancelled responses so the model sees what was produced', () => {
      const conv = store.createConversation();
      store.addMessage(conv.id, userMsg('Q'));
      store.addMessage(conv.id, { role: 'assistant', content: 'partial…', status: 'cancelled' });
      expect(store.historyForRequest(conv.id)).toEqual([
        { role: 'user', content: 'Q' },
        { role: 'assistant', content: 'partial…' }
      ]);
    });
  });

  describe('isolation between conversations', () => {
    it('message operations on one conversation never affect another', () => {
      const a = store.createConversation();
      const b = store.createConversation();
      store.addMessage(a.id, userMsg('in A'));
      store.clearMessages(b.id);
      expect(store.conversations().find((c) => c.id === a.id)?.messages).toHaveLength(1);
    });
  });
});
