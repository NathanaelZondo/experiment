/**
 * Conversation store (in-memory only — no localStorage/sessionStorage/IndexedDB).
 *
 * Signal-based store for conversations: create, select, rename and delete;
 * automatic titles derived from the first user message; a separate system
 * prompt per conversation; and the Phase 8 message operations (edit + truncate,
 * regenerate point, delete with dependents, clear).
 */

import { Injectable, computed, signal } from '@angular/core';
import { uid } from './uid';
import type { ChatMessage, ChatMessageDto, Conversation } from './types/lm-studio.types';

export const DEFAULT_CONVERSATION_TITLE = 'New chat';
const TITLE_MAX_LENGTH = 42;

/** Derive a friendly title from the first user message. */
export function deriveTitle(content: string): string {
  const firstLine = content.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  const flat = firstLine.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return DEFAULT_CONVERSATION_TITLE;
  return flat.length <= TITLE_MAX_LENGTH ? flat : `${flat.slice(0, TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

@Injectable({ providedIn: 'root' })
export class ConversationStore {
  readonly conversations = signal<Conversation[]>([]);
  readonly activeId = signal<string | null>(null);

  readonly active = computed(() => this.conversations().find((c) => c.id === this.activeId()) ?? null);

  /* ------------------------------ conversation ops ----------------------------- */

  createConversation(): Conversation {
    const now = Date.now();
    const conversation: Conversation = {
      id: uid('conv'),
      title: DEFAULT_CONVERSATION_TITLE,
      systemPrompt: '',
      messages: [],
      createdAt: now,
      updatedAt: now
    };
    this.conversations.update((list) => [conversation, ...list]);
    this.activeId.set(conversation.id);
    return conversation;
  }

  select(id: string): void {
    if (this.conversations().some((c) => c.id === id)) this.activeId.set(id);
  }

  rename(id: string, title: string): void {
    const clean = title.trim();
    if (!clean) return;
    this.updateConversation(id, (c) => ({ ...c, title: clean.slice(0, 80), updatedAt: Date.now() }));
  }

  /** Delete a conversation. Returns true when it existed. */
  deleteConversation(id: string): boolean {
    const exists = this.conversations().some((c) => c.id === id);
    if (!exists) return false;
    this.conversations.update((list) => list.filter((c) => c.id !== id));
    if (this.activeId() === id) {
      const remaining = this.conversations();
      this.activeId.set(remaining.length > 0 ? remaining[0].id : null);
    }
    return true;
  }

  setSystemPrompt(id: string, prompt: string): void {
    this.updateConversation(id, (c) => ({ ...c, systemPrompt: prompt, updatedAt: Date.now() }));
  }

  /* --------------------------------- message ops ------------------------------- */

  /** Append a message; derives the conversation title from the first user message. */
  addMessage(conversationId: string, partial: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage | null {
    const conversation = this.conversations().find((c) => c.id === conversationId);
    if (!conversation) return null;
    const message: ChatMessage = { ...partial, id: uid('msg'), createdAt: Date.now() };
    let title = conversation.title;
    if (message.role === 'user' && title === DEFAULT_CONVERSATION_TITLE) {
      title = deriveTitle(message.content);
    }
    this.updateConversation(conversationId, (c) => ({
      ...c,
      title,
      messages: [...c.messages, message],
      updatedAt: Date.now()
    }));
    return message;
  }

  updateMessage(conversationId: string, messageId: string, patch: Partial<Omit<ChatMessage, 'id'>>): void {
    this.updateConversation(conversationId, (c) => ({
      ...c,
      messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      updatedAt: Date.now()
    }));
  }

  /** Find a message by id within a conversation. */
  findMessage(conversationId: string, messageId: string): ChatMessage | undefined {
    return this.conversations().find((c) => c.id === conversationId)?.messages.find((m) => m.id === messageId);
  }

  /* ------------------------------ Phase 8 operations --------------------------- */

  /**
   * Edit a user message and discard every dependent later response.
   * Returns the number of messages removed after the edited one (0 when it was last).
   */
  editUserMessage(conversationId: string, messageId: string, newContent: string): number {
    const conversation = this.conversations().find((c) => c.id === conversationId);
    if (!conversation) return 0;
    const index = conversation.messages.findIndex((m) => m.id === messageId);
    if (index === -1 || conversation.messages[index].role !== 'user') return 0;
    const removed = conversation.messages.length - 1 - index;
    this.updateConversation(conversationId, (c) => ({
      ...c,
      messages: c.messages.slice(0, index + 1).map((m) => (m.id === messageId ? { ...m, content: newContent } : m)),
      updatedAt: Date.now()
    }));
    return removed;
  }

  /** Delete a message and every dependent later message (history truncation). */
  deleteMessageWithDependents(conversationId: string, messageId: string): number {
    const conversation = this.conversations().find((c) => c.id === conversationId);
    if (!conversation) return 0;
    const index = conversation.messages.findIndex((m) => m.id === messageId);
    if (index === -1) return 0;
    const removed = conversation.messages.length - index;
    this.updateConversation(conversationId, (c) => ({
      ...c,
      messages: c.messages.slice(0, index),
      updatedAt: Date.now()
    }));
    return removed;
  }

  /** Remove the latest assistant response (regenerate point). */
  removeLatestAssistantMessage(conversationId: string): boolean {
    const conversation = this.conversations().find((c) => c.id === conversationId);
    if (!conversation) return false;
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      if (conversation.messages[i].role === 'assistant') {
        this.updateConversation(conversationId, (c) => ({
          ...c,
          messages: [...c.messages.slice(0, i), ...c.messages.slice(i + 1)],
          updatedAt: Date.now()
        }));
        return true;
      }
    }
    return false;
  }

  /** Clear all messages of a conversation (keeps title and system prompt). */
  clearMessages(conversationId: string): void {
    this.updateConversation(conversationId, (c) => ({ ...c, messages: [], updatedAt: Date.now() }));
  }

  /* --------------------------------- request data ------------------------------ */

  /**
   * Complete in-memory history for a generation request: the conversation's
   * system prompt (when set) followed by every user/assistant message that has
   * content. Failed empty messages are skipped; partial cancelled responses are
   * included so the model sees what was actually produced.
   */
  historyForRequest(conversationId: string): ChatMessageDto[] {
    const conversation = this.conversations().find((c) => c.id === conversationId);
    if (!conversation) return [];
    const messages: ChatMessageDto[] = [];
    if (conversation.systemPrompt.trim().length > 0) {
      messages.push({ role: 'system', content: conversation.systemPrompt });
    }
    for (const m of conversation.messages) {
      if ((m.role === 'user' || m.role === 'assistant') && m.content.trim().length > 0) {
        messages.push({ role: m.role, content: m.content });
      }
    }
    return messages;
  }

  /* ---------------------------------- internals -------------------------------- */

  private updateConversation(id: string, updater: (c: Conversation) => Conversation): void {
    this.conversations.update((list) => list.map((c) => (c.id === id ? updater(c) : c)));
  }
}
