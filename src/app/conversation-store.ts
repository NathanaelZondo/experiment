import { Injectable, computed, signal } from '@angular/core';
import { ChatStats, ChatUsage } from './lmstudio/chat-types';

export type MessageRole = 'user' | 'assistant';

/** Lifecycle of a message: in flight, finished successfully, or failed. */
export type MessageStatus = 'sending' | 'completed' | 'failed';

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
  at: number;
  /** Present on assistant messages while generating or after a failure. */
  status?: MessageStatus;
  /** Human-readable error when the message failed (never contains the API token). */
  error?: string;
  /** Actionable steps for the user, present alongside `error`. */
  guidance?: string[];
  /** Reasoning/thinking text supplied by the model (collapsible in the UI). */
  reasoning?: string;
  /** Token usage reported by the server. */
  usage?: ChatUsage;
  /** Performance statistics reported by the server. */
  stats?: ChatStats;
  /** Model id that produced this message. */
  modelId?: string;
  /** True when generation was stopped by the user and partial text is kept. */
  stopped?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  systemPrompt: string;
  messages: Message[];
}

const DEFAULT_TITLE = 'New conversation';
const TITLE_MAX_LENGTH = 40;

/**
 * In-memory, Signal-based conversation store.
 * All state lives in RAM only — no localStorage, sessionStorage,
 * IndexedDB or database is used, so everything clears on refresh.
 */
@Injectable({ providedIn: 'root' })
export class ConversationStore {
  readonly conversations = signal<Conversation[]>([]);
  readonly selectedId = signal<string | null>(null);

  private idCounter = 0;

  /** The conversation currently in focus (or undefined). */
  readonly selected = computed(() => this.get(this.selectedId()));

  private nextId(): string {
    this.idCounter += 1;
    return `c-${Date.now().toString(36)}-${this.idCounter}`;
  }

  create(): Conversation {
    const conversation: Conversation = {
      id: this.nextId(),
      title: DEFAULT_TITLE,
      systemPrompt: '',
      messages: [],
    };
    this.conversations.update((list) => [conversation, ...list]);
    this.selectedId.set(conversation.id);
    return conversation;
  }

  select(id: string): void {
    if (this.get(id)) {
      this.selectedId.set(id);
    }
  }

  get(id: string | null): Conversation | undefined {
    if (!id) {
      return undefined;
    }
    return this.conversations().find((c) => c.id === id);
  }

  rename(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) {
      return;
    }
    this.updateConversation(id, (c) => ({ ...c, title: trimmed.slice(0, TITLE_MAX_LENGTH + 1) }));
  }

  setSystemPrompt(id: string, prompt: string): void {
    this.updateConversation(id, (c) => ({ ...c, systemPrompt: prompt }));
  }

  /** Returns true when the conversation has messages. */
  isNonEmpty(id: string | null): boolean {
    return (this.get(id)?.messages.length ?? 0) > 0;
  }

  delete(id: string): void {
    this.conversations.update((list) => list.filter((c) => c.id !== id));
    if (this.selectedId() === id) {
      const remaining = this.conversations().filter((c) => c.id !== id);
      this.selectedId.set(remaining.length > 0 ? remaining[0].id : null);
    }
  }

  /** Appends a user message and derives the title if needed. Returns the new message. */
  appendUserMessage(id: string, text: string): Message | null {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }
    const conversation = this.get(id);
    if (!conversation) {
      return null;
    }

    const message: Message = { id: this.messageId(), role: 'user', text: trimmed, at: Date.now() };
    this.updateConversation(id, (c) => ({
      ...c,
      title: c.title === DEFAULT_TITLE ? deriveTitle(trimmed) : c.title,
      messages: [...c.messages, message],
    }));
    return message;
  }

  /** Creates a `sending` assistant placeholder and returns it. */
  beginAssistantReply(id: string): Message | null {
    const conversation = this.get(id);
    if (!conversation) {
      return null;
    }
    const message: Message = { id: this.messageId(), role: 'assistant', text: '', at: Date.now(), status: 'sending' };
    this.updateConversation(id, (c) => ({ ...c, messages: [...c.messages, message] }));
    return message;
  }

  /** Replaces the visible text of an in-flight assistant message. */
  updateAssistantText(conversationId: string, messageId: string, text: string): void {
    this.patchMessage(conversationId, messageId, (m) => ({ ...m, text }));
  }

  /** Appends reasoning text to an in-flight assistant message. */
  appendReasoning(conversationId: string, messageId: string, delta: string): void {
    if (!delta) {
      return;
    }
    this.patchMessage(conversationId, messageId, (m) => ({ ...m, reasoning: `${m.reasoning ?? ''}${delta}` }));
  }

  /** Marks an assistant message completed, optionally with aggregated stats. */
  completeAssistant(
    conversationId: string,
    messageId: string,
    result?: { text?: string; usage?: ChatUsage; stats?: ChatStats; modelId?: string }
  ): void {
    this.patchMessage(conversationId, messageId, (m) => ({
      ...m,
      status: 'completed',
      error: undefined,
      guidance: undefined,
      text: result?.text !== undefined ? result.text : m.text,
      usage: result?.usage ?? m.usage,
      stats: result?.stats ?? m.stats,
      modelId: result?.modelId ?? m.modelId,
    }));
  }

  /** Marks an assistant message failed with a token-free error and guidance. */
  failAssistant(conversationId: string, messageId: string, error: string, guidance?: string[]): void {
    this.patchMessage(conversationId, messageId, (m) => ({
      ...m,
      status: 'failed',
      error,
      guidance,
    }));
  }

  /** Marks an in-flight assistant message as stopped by the user; partial text is kept. */
  stopAssistant(conversationId: string, messageId: string): void {
    this.patchMessage(conversationId, messageId, (m) => ({
      ...m,
      status: 'completed',
      error: undefined,
      guidance: undefined,
      stopped: true,
    }));
  }

  /**
   * Replaces the text of a user message. Blank edits are rejected so a message
   * can never become empty. Returns true when the edit was applied.
   */
  updateUserMessage(conversationId: string, messageId: string, text: string): boolean {
    const trimmed = text.trim();
    if (trimmed === '') {
      return false;
    }
    let applied = false;
    this.patchMessage(conversationId, messageId, (m) => {
      if (m.role !== 'user') {
        return m;
      }
      applied = true;
      return { ...m, text: trimmed };
    });
    return applied;
  }

  /** Removes a single message from the conversation. */
  deleteMessage(conversationId: string, messageId: string): void {
    this.updateConversation(conversationId, (c) => ({
      ...c,
      messages: c.messages.filter((m) => m.id !== messageId),
    }));
  }

  /**
   * Keeps the conversation up to and including `messageId`, dropping everything
   * after it. Used when an edited message invalidates dependent responses.
   */
  removeMessagesAfter(conversationId: string, messageId: string): void {
    this.updateConversation(conversationId, (c) => {
      const index = c.messages.findIndex((m) => m.id === messageId);
      if (index === -1) {
        return c;
      }
      return { ...c, messages: c.messages.slice(0, index + 1) };
    });
  }

  /** Removes all messages but keeps the conversation itself (title and system prompt). */
  clearMessages(conversationId: string): void {
    this.updateConversation(conversationId, (c) => ({ ...c, messages: [] }));
  }

  private patchMessage(conversationId: string, messageId: string, updater: (m: Message) => Message): void {
    this.updateConversation(conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? updater(m) : m)),
    }));
  }

  private messageId(): string {
    return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private updateConversation(id: string, updater: (c: Conversation) => Conversation): void {
    this.conversations.update((list) => list.map((c) => (c.id === id ? updater(c) : c)));
  }
}

/** Derives a friendly title from the first user message. */
export function deriveTitle(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return DEFAULT_TITLE;
  }
  return collapsed.length > TITLE_MAX_LENGTH ? `${collapsed.slice(0, TITLE_MAX_LENGTH).trimEnd()}…` : collapsed;
}
