import { Injectable, signal, computed } from '@angular/core';

export type ConversationId = string;

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Model name used for generation (optional) */
  modelName?: string;
  /** Generation timestamp (ISO string) */
  timestamp?: string;
}

export interface Conversation {
  id: ConversationId;
  title: string;
  messages: Message[];
  systemPrompt: string;
}

/**
 * Valid temperature range: 0 to 2
 * Valid top-p range: 0 to 1
 * Valid top-k range: >= 0 (or -1 for default)
 * Valid repeat penalty: > 0
 */
export interface GenerationConfig {
  temperature?: number;
  topP?: number;
  topK?: number;
  repeatPenalty?: number;
  maxTokens?: number;
  reasoningMode?: 'disabled' | 'enabled' | 'auto';
}

/**
 * Standalone helper function to trim titles.
 */
function trimmedTitle(content: string): string {
  const trimmed = content.trim();
  return trimmed.length > 50 ? trimmed.substring(0, 47) + '...' : trimmed;
}

/**
 * In-memory conversation store using Angular signals.
 * No localStorage, sessionStorage, IndexedDB, or database is used.
 * Refreshing the page clears all chats (explicitly indicated).
 */
let idCounter = 0;

function generateId(): ConversationId {
  return `conv_${Date.now()}_${idCounter++}`;
}

/**
 * Validates temperature value is within supported range [0, 2]
 */
function validateTemperature(temp: number): boolean {
  return typeof temp === 'number' && !isNaN(temp) && temp >= 0 && temp <= 2;
}

/**
 * Validates top-p value is within supported range [0, 1]
 */
function validateTopP(topP: number): boolean {
  return typeof topP === 'number' && !isNaN(topP) && topP >= 0 && topP <= 1;
}

/**
 * Validates top-k value
 */
function validateTopK(topK: number): boolean {
  return Number.isInteger(topK) || topK === -1;
}

/**
 * Validates repeat penalty value
 */
function validateRepeatPenalty(penalty: number): boolean {
  return typeof penalty === 'number' && !isNaN(penalty) && penalty > 0;
}

@Injectable({ providedIn: 'root' })
export class ConversationService {
  /** All conversations in memory, keyed by id */
  protected readonly conversations = signal<Conversation[]>([]);

  /** Currently selected conversation id, or null if none - publicly accessible */
  public readonly selectedId = signal<string | null>(null);

  /** Whether this is the first use (no conversations exist yet) */
  public readonly firstUse = computed(() => this.conversations().length === 0);

  /** Explicit indicator that chats are session-only and refreshing clears them */
  public readonly sessionOnlyNote = 'Session only — refreshing clears chats';

  /**
   * Create a new conversation with an auto-generated title from the first user message.
   * If no messages yet, title defaults to "New Conversation".
   */
  public createConversation(firstMessage?: string): Conversation {
    const id = generateId();

    let title = 'New Conversation';
    if (firstMessage) {
      const trimmed = firstMessage.trim();
      title = trimmed.length > 50 ? trimmed.substring(0, 47) + '...' : trimmed;
    }

    const newConversation: Conversation = {
      id,
      title,
      messages: [],
      systemPrompt: '',
    };

    this.conversations.update((list) => [...list, newConversation]);
    this.selectConversation(id);
    return newConversation;
  }

  /** Select a conversation by id */
  public selectConversation(id: string): void {
    this.selectedId.set(id);
  }

  /** Deselect all conversations */
  public deselectConversation(): void {
    this.selectedId.set(null);
  }

  /** Get the currently selected conversation, or null */
  public getSelected(): Conversation | null {
    const conv = this.conversations().find((c) => c.id === this.selectedId());
    return conv ?? null;
  }

  /** Get messages for the currently selected conversation */
  public getMessages(): Message[] {
    const selected = this.getSelected();
    return selected ? [...selected.messages] : [];
  }

  /** Get the system prompt for the currently selected conversation */
  public getSystemPrompt(): string {
    const selected = this.getSelected();
    return selected ? selected.systemPrompt : '';
  }

  /** Set the system prompt for the currently selected conversation */
  public setSystemPrompt(prompt: string): void {
    const id = this.selectedId();
    if (!id) return;

    this.conversations.update((list) =>
      list.map((c) => (c.id === id ? { ...c, systemPrompt: prompt } : c)),
    );
  }

  /** Add a user message to the currently selected conversation */
  public addUserMessage(content: string): void {
    const id = this.selectedId();
    if (!id) return;

    const message: Message = {
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
    };

    this.conversations.update((list) =>
      list.map((c) =>
        c.id === id
          ? {
              ...c,
              messages: [...c.messages, message],
              // Auto-title from first user message if not set or using default
              title:
                c.title === 'New Conversation' && c.messages.length === 1
                  ? trimmedTitle(message.content.trim())
                  : c.title,
            }
      ),
    );
  }

  /** Add an assistant message to the currently selected conversation */
  public addAssistantMessage(content: string, modelName?: string): void {
    const id = this.selectedId();
    if (!id) return;

    const message: Message = {
      role: 'assistant',
      content,
      modelName,
      timestamp: new Date().toISOString(),
    };

    this.conversations.update((list) =>
      list.map((c) =>
        c.id === id ? { ...c, messages: [...c.messages, message] } : c,
      ),
    );
  }

  /** Rename the currently selected conversation */
  public renameConversation(newTitle: string): void {
    const id = this.selectedId();
    if (!id) return;

    this.conversations.update((list) =>
      list.map((c) => (c.id === id ? { ...c, title: newTitle } : c)),
    );
  }

  /** Delete a conversation with confirmation */
  public deleteConversation(id: string): boolean {
    const conversation = this.conversations().find((c) => c.id === id);
    const isNonEmpty = conversation && conversation.messages.length > 0;

    if (isNonEmpty) {
      const confirmed = confirm(
        `Delete conversation "${conversation.title}"? It has ${conversation.messages.length} message(s).`,
      );
      if (!confirmed) {
        return false;
      }
    }

    this.conversations.update((list) => list.filter((c) => c.id !== id));

    // If the deleted conversation was selected, deselect
    if (this.selectedId() === id) {
      this.deselectConversation();
    }

    return true;
  }

  /** Get all conversation ids */
  public getConversationIds(): string[] {
    return this.conversations().map((c) => c.id);
  }

  /** Get all conversations (read-only snapshot) */
  public getAllConversations(): readonly Conversation[] {
    return this.conversations();
  }

  /** Clear all conversations (for session reset) */
  public clearAll(): void {
    this.conversations.set([]);
    this.deselectConversation();
  }

  /** Get the session-only indicator text */
  public getSessionOnlyNote(): string {
    return this.sessionOnlyNote;
  }

  /**
   * Delete a message at the given index from the selected conversation.
   * Returns true if deletion was successful.
   */
  public deleteMessage(messageIndex: number): boolean {
    const selected = this.getSelected();
    if (!selected) return false;

    if (messageIndex < 0 || messageIndex >= selected.messages.length) {
      return false;
    }

    // If deleting an assistant message, also remove any subsequent user/assistant pairs
    // that were generated in response to this message
    let endIdx = selected.messages.length;

    const msg = selected.messages[messageIndex];
    if (msg.role === 'assistant') {
      for (let i = messageIndex + 1; i < selected.messages.length; i++) {
        const m = selected.messages[i];
        if (m.role === 'user') {
          endIdx = i + 1;
          if (
            i + 1 < selected.messages.length &&
            selected.messages[i + 1].role === 'assistant'
          ) {
            continue;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }

    this.conversations.update((list) =>
      list.map((c) =>
        c.id === selected.id
          ? {
              ...c,
              messages: [
                ...selected.messages.slice(0, messageIndex),
                ...selected.messages.slice(endIdx),
              ],
            }
      ),
    );

    return true;
  }

  /**
   * Regenerate the latest assistant response.
   * If there's an assistant message at the end, remove it and resend.
   * Returns true if regeneration was triggered.
   */
  public regenerateLatestResponse(): boolean {
    const selected = this.getSelected();
    if (!selected) return false;

    const messages = selected.messages;
    if (messages.length === 0) return false;

    // Find the last assistant message
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }

    if (lastAssistantIdx === -1) return false;

    // Remove the last assistant message and any user message that preceded it
    let startFromIndex = lastAssistantIdx;

    // Check if there's a user message right before the assistant message
    if (
      lastAssistantIdx > 0 &&
      messages[lastAssistantIdx - 1].role === 'user'
    ) {
      // Remove both the user and assistant message pair
      startFromIndex = lastAssistantIdx - 1;
    }

    // Keep all messages before the regeneration point
    const messagesBefore = messages.slice(0, startFromIndex);

    this.conversations.update((list) =>
      list.map((c) =>
        c.id === selected.id
          ? {
              ...c,
              messages: [...messagesBefore],
            }
      ),
    );

    // Trigger a new message send from this point - the UI should handle calling
    // addUserMessage and then sending for generation
    // For now, we just set up the state - the component will handle the actual regeneration

    return true;
  }

  /**
   * Edit a user message at the given index and regenerate from that point.
   * Discards any dependent later responses.
   *
   * @param messageIndex - Index of the user message to edit
   * @param newContent - New content for the message
   * @returns True if edit was successful
   */
  public editAndRegenerate(messageIndex: number, newContent: string): boolean {
    const selected = this.getSelected();
    if (!selected) return false;

    const messages = selected.messages;
    if (messageIndex < 0 || messageIndex >= messages.length) return false;

    // Verify it's a user message
    if (messages[messageIndex].role !== 'user') return false;

    // Update the user message content and timestamp
    messages[messageIndex].content = newContent;
    messages[messageIndex].timestamp = new Date().toISOString();

    // Remove all messages after the edited user message (dependent assistant responses)
    const messagesToKeep = messages.slice(0, messageIndex + 1);

    this.conversations.update((list) =>
      list.map((c) =>
        c.id === selected.id
          ? {
              ...c,
              messages: [...messagesToKeep],
            }
      ),
    );

    // Trigger regeneration from this point - the UI should handle calling
    // addUserMessage (if not already there) and then sendMessage for generation
    // For now, we just set up the state

    return true;
  }

  /**
   * Get generation config for the selected conversation.
   */
  public getGenerationConfig(): GenerationConfig {
    const selected = this.getSelected();
    if (!selected || selected.messages.length === 0) return {};

    return {};
  }

  /**
   * Set generation config for the conversation.
   * In a real app, this would be stored per-conversation or in global settings.
   */
  public setGenerationConfig(config: GenerationConfig): void {
    // Config is applied at generation time, not stored permanently
    // This method exists for UI binding and could store to localStorage in a full app
  }

  /**
   * Reset generation settings to defaults.
   */
  public resetGenerationConfig(): void {
    // No-op in this implementation - settings are applied per-request
  }
}