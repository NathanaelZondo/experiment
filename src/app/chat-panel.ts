import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, effect, inject, signal } from '@angular/core';
import { ConversationStore, Message } from './conversation-store';
import { ChatService, GenerationActivity } from './chat/chat.service';
import { copyTextToClipboard } from './chat/markdown';
import { Markdown } from './chat/markdown.directive';
import { LmStudioService } from './lmstudio/lm-studio.service';
import { formatClockTime } from './lmstudio/format';
import { Button } from './design-system/button';
import { Dialog } from './design-system/dialog';
import { IconButton } from './design-system/icon-button';
import { Icon } from './design-system/icon';
import { StatusBadge } from './design-system/status-badge';

/** Distance from the bottom (px) within which we still consider the user "at the bottom". */
const NEAR_BOTTOM_PX = 80;

@Component({
  selector: 'app-chat-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, Dialog, IconButton, Icon, StatusBadge, Markdown],
  template: `
    <div class="chat">
      @if (store.selected(); as conv) {
        <header class="chat-header">
          <h1 class="chat-title">{{ conv.title }}</h1>
          @if (conv.systemPrompt.trim()) {
            <span class="chat-prompt-hint">System prompt active</span>
          }
          @if (lm.loadedModel(); as model) {
            <app-status-badge tone="success" [text]="'Loaded: ' + (model.displayName ?? model.id)"></app-status-badge>
          }
          @if (conv.messages.length > 0) {
            <span class="chat-header-spacer"></span>
            <app-icon-button label="Clear all messages in this conversation" (click)="requestClearConversation()">
              <app-icon name="trash" [size]="16"></app-icon>
            </app-icon-button>
          }
        </header>

        @if (conv.messages.length === 0) {
          <div class="chat-empty" role="status">
            <app-icon name="chat" [size]="40"></app-icon>
            <h2>This conversation is empty</h2>
            <p>Say hello below — load a model in Settings and the assistant will reply.</p>
          </div>
        } @else {
          <div class="message-wrap">
            <ol class="message-list" aria-label="Messages" (scroll)="onScroll()">
              @for (m of conv.messages; track m.id; let i = $index) {
                <li
                  [class]="'message message--' + m.role"
                  [class.message--failed]="m.status === 'failed'"
                  [class.message--sending]="m.status === 'sending'"
                >
                  <div class="message-head">
                    <span class="message-role">{{ m.role === 'user' ? 'You' : 'Assistant' }}</span>
                    @if (m.modelId) {
                      <span class="message-model" [title]="m.modelId">{{ modelLabel(m.modelId) }}</span>
                    }
                    <time class="message-time" [attr.datetime]="isoTime(m.at)">{{ formatTime(m.at) }}</time>
                    @if (m.stopped) {
                      <span class="message-stopped-chip">Stopped</span>
                    }
                    <span class="message-actions">
                      @if (m.role === 'user' && editingMessageId() !== m.id) {
                        <app-icon-button label="Edit your message and regenerate" [disabled]="chat.generating()" (click)="startEditing(m)">
                          <app-icon name="pencil" [size]="14"></app-icon>
                        </app-icon-button>
                      }
                      @if (m.role === 'assistant' && i === lastActionableIndex(conv.messages)) {
                        <app-icon-button label="Regenerate response" [disabled]="chat.generating()" (click)="regenerate()">
                          <app-icon name="refresh" [size]="14"></app-icon>
                        </app-icon-button>
                      }
                      @if (m.role === 'user' && i === lastActionableIndex(conv.messages)) {
                        <app-icon-button label="Generate response for this message" [disabled]="chat.generating()" (click)="regenerate()">
                          <app-icon name="refresh" [size]="14"></app-icon>
                        </app-icon-button>
                      }
                      <app-icon-button
                        [label]="m.role === 'user' ? 'Copy your message' : 'Copy response'"
                        (click)="copyMessage(m)"
                      >
                        <app-icon [name]="copiedId() === m.id ? 'check' : 'copy'" [size]="14"></app-icon>
                      </app-icon-button>
                      @if (m.status !== 'sending') {
                        <app-icon-button label="Delete message" [disabled]="chat.generating()" (click)="deleteMessage(m)">
                          <app-icon name="trash" [size]="14"></app-icon>
                        </app-icon-button>
                      }
                    </span>
                  </div>

                  @if (m.role === 'assistant' && m.reasoning !== undefined && m.reasoning.length > 0) {
                    <details class="message-reasoning">
                      <summary>Reasoning</summary>
                      <div class="message-reasoning-body markdown-body" [markdown]="m.reasoning"></div>
                    </details>
                  }

                  @if (editingMessageId() === m.id) {
                    <form class="message-edit-form" (submit)="saveEdit($event, m)">
                      <label for="edit-input-{{ m.id }}" class="visually-hidden">Edit your message</label>
                      <textarea
                        id="edit-input-{{ m.id }}"
                        class="composer-textarea message-edit-textarea"
                        rows="3"
                        [value]="editingDraft()"
                        (input)="onEditInput($event)"
                        (keydown.enter)="onEditKeydown($event, m)"
                        (keydown.escape)="cancelEditing()"
                      ></textarea>
                      <div class="message-edit-actions">
                        <app-button size="sm" variant="secondary" type="button" (click)="cancelEditing()">Cancel</app-button>
                        <app-button size="sm" type="submit" [disabled]="!editingDraft().trim()">Save & regenerate</app-button>
                      </div>
                    </form>
                  } @else if (m.text.length > 0) {
                    <div class="message-text markdown-body" [markdown]="m.text"></div>
                  }

                  @if (m.status === 'sending' && m.text.length === 0) {
                    <div class="message-thinking">
                      <span class="btn-spinner message-spinner" aria-hidden="true"></span>
                      <span>Thinking…</span>
                    </div>
                  }

                  @if (m.status === 'failed') {
                    <div class="message-error" role="alert">
                      <p>{{ m.error }}</p>
                      @if (m.guidance !== undefined && m.guidance.length > 0) {
                        <ul>
                          @for (g of m.guidance; track $index) {
                            <li>{{ g }}</li>
                          }
                        </ul>
                      }
                    </div>
                  }
                </li>
              }
            </ol>

            @if (showJump()) {
              <button type="button" class="jump-latest" (click)="jumpToLatest()">↓ Latest</button>
            }
          </div>
        }

        <div class="composer-area">
          @if (chat.noModelHint()) {
            <p class="composer-hint" role="status">Load a model in Settings to start chatting.</p>
          }
          @if (chat.activity(); as act) {
            <div class="composer-status" role="status">{{ activityText(act) }}</div>
          }

          <form class="composer" (submit)="onSend($event)">
            <label for="composer-input" class="visually-hidden">Message</label>
            <textarea
              id="composer-input"
              class="composer-textarea"
              rows="3"
              placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
              [value]="draft()"
              (input)="onDraftInput($event)"
              (keydown.enter)="onComposerKeydown($event)"
            ></textarea>

            @if (chat.generating()) {
              <app-button variant="danger" type="button" (click)="onStop()">
                <app-icon name="stop" [size]="15"></app-icon>
                Stop
              </app-button>
            } @else {
              <app-button type="submit" [disabled]="!draft().trim() || !lm.hasLoadedModel()">
                <app-icon name="send" [size]="15"></app-icon>
                Send
              </app-button>
            }
          </form>

          @if (!lm.hasLoadedModel()) {
            <p class="composer-hint">No model loaded — load one in Settings to enable sending.</p>
          }
        </div>
      } @else {
        <div class="chat-welcome" role="status">
          <app-icon name="chat" [size]="48"></app-icon>
          <h2>Welcome to Experiment</h2>
          <p>Everything you write here lives in memory only — refreshing the page clears all chats.</p>
          <app-button (click)="store.create()">Start a conversation</app-button>
        </div>
      }

      @if (clearingConversation()) {
        <app-dialog [open]="true" title="Clear this conversation?" (close)="cancelClearConversation()">
          <p>
            All messages in “{{ store.selected()?.title ?? 'this conversation' }}” will be removed. This cannot be
            undone — and since this is a session-only app, nothing survives a refresh anyway.
          </p>
          <div class="dialog-actions">
            <app-button variant="secondary" (click)="cancelClearConversation()">Cancel</app-button>
            <app-button variant="danger" (click)="confirmClearConversation()">Clear messages</app-button>
          </div>
        </app-dialog>
      }
    </div>
  `,
  styleUrl: './chat-panel.scss'
})
export class ChatPanel {
  readonly store = inject(ConversationStore);
  readonly chat = inject(ChatService);
  readonly lm = inject(LmStudioService);

  protected readonly draft = signal('');
  /** Id of the message whose copy button shows "copied" feedback. */
  protected readonly copiedId = signal<string | null>(null);
  /** True while new content is arriving and the user has scrolled up. */
  protected readonly showJump = signal(false);
  /** User message currently being edited (null when not editing). */
  protected readonly editingMessageId = signal<string | null>(null);
  /** Draft text of the in-progress edit. */
  protected readonly editingDraft = signal('');
  /** True while the clear-conversation confirmation dialog is open. */
  protected readonly clearingConversation = signal(false);

  /** User intent: keep following the bottom (false once they scroll up). */
  private stickToBottom = true;
  private lastConversationId: string | null = null;

  @ViewChild('.message-list') private messageList?: ElementRef<HTMLOListElement>;

  constructor() {
    // Keep the newest content in view — but only while the user is at the bottom.
    effect(() => {
      const conv = this.store.selected();
      if (conv === undefined || conv.messages.length === 0) {
        return;
      }
      // A conversation switch always resumes following from the latest message.
      if (this.lastConversationId !== null && this.lastConversationId !== conv.id) {
        this.stickToBottom = true;
        this.showJump.set(false);
      }
      this.lastConversationId = conv.id;

      requestAnimationFrame(() => {
        const list = this.messageList?.nativeElement;
        if (list && this.stickToBottom) {
          list.scrollTop = list.scrollHeight;
        }
      });
    });
  }

  onDraftInput(event: Event): void {
    this.draft.set((event.target as HTMLTextAreaElement).value);
  }

  /** Enter sends; Shift+Enter inserts a newline. */
  onComposerKeydown(event: Event): void {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
      event.preventDefault();
      this.send();
    }
  }

  onSend(event: SubmitEvent): void {
    event.preventDefault();
    this.send();
  }

  private send(): void {
    const text = this.draft().trim();
    const id = this.store.selectedId();
    if (!text || !id) {
      return;
    }
    // A new exchange always resumes following the bottom.
    this.stickToBottom = true;
    this.showJump.set(false);
    this.chat.send(id, text);
    this.draft.set('');
  }

  onStop(): void {
    this.chat.stop();
  }

  /** Tracks whether the user is near the bottom of the message list. */
  onScroll(): void {
    const list = this.messageList?.nativeElement;
    if (!list) {
      return;
    }
    const distanceFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    this.stickToBottom = distanceFromBottom <= NEAR_BOTTOM_PX;
    this.showJump.set(!this.stickToBottom);
  }

  jumpToLatest(): void {
    const list = this.messageList?.nativeElement;
    if (!list) {
      return;
    }
    list.scrollTop = list.scrollHeight;
    this.stickToBottom = true;
    this.showJump.set(false);
  }

  copyMessage(message: Message): void {
    void copyTextToClipboard(message.text).then((ok) => {
      if (!ok) {
        return;
      }
      this.copiedId.set(message.id);
      setTimeout(() => {
        if (this.copiedId() === message.id) {
          this.copiedId.set(null);
        }
      }, 1500);
    });
  }

  activityText(activity: GenerationActivity): string {
    return activity === 'waiting' ? 'Waiting for first token…' : 'Generating…';
  }

  // --- Phase 8: message operations ---------------------------------------

  /** Index of the last actionable message (skips in-flight and failed ones). */
  lastActionableIndex(messages: Message[]): number {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.status !== 'sending' && m.status !== 'failed') {
        return i;
      }
    }
    return -1;
  }

  /** Short display name for a model id: the last path segment. */
  modelLabel(modelId: string): string {
    const segments = modelId.split('/');
    return segments[segments.length - 1];
  }

  formatTime(timestamp: number): string {
    return formatClockTime(timestamp);
  }

  isoTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  // --- Edit & regenerate ---------------------------------------------------

  startEditing(message: Message): void {
    if (this.chat.generating()) {
      return;
    }
    this.editingMessageId.set(message.id);
    this.editingDraft.set(message.text);
  }

  onEditInput(event: Event): void {
    this.editingDraft.set((event.target as HTMLTextAreaElement).value);
  }

  /** Enter saves (Shift+Enter inserts a newline); Escape cancels. */
  onEditKeydown(event: Event, message: Message): void {
    const keyEvent = event as KeyboardEvent;
    if (keyEvent.key === 'Escape') {
      this.cancelEditing();
      return;
    }
    if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
      event.preventDefault();
      this.saveEdit(new SubmitEvent('submit'), message);
    }
  }

  saveEdit(event: Event, message: Message): void {
    event.preventDefault();
    const id = this.store.selectedId();
    if (!id || this.editingMessageId() !== message.id) {
      return;
    }
    // The service applies the edit and discards dependent responses before
    // resending the revised history.
    this.chat.editAndRegenerate(id, message.id, this.editingDraft());
    this.cancelEditing();
  }

  cancelEditing(): void {
    this.editingMessageId.set(null);
    this.editingDraft.set('');
  }

  // --- Regenerate / delete / clear ----------------------------------------

  regenerate(): void {
    const id = this.store.selectedId();
    if (!id) {
      return;
    }
    this.stickToBottom = true;
    this.showJump.set(false);
    this.chat.regenerateLatest(id);
  }

  deleteMessage(message: Message): void {
    const id = this.store.selectedId();
    if (!id) {
      return;
    }
    if (this.editingMessageId() === message.id) {
      this.cancelEditing();
    }
    this.chat.deleteMessage(id, message.id);
  }

  requestClearConversation(): void {
    this.clearingConversation.set(true);
  }

  cancelClearConversation(): void {
    this.clearingConversation.set(false);
  }

  confirmClearConversation(): void {
    const id = this.store.selectedId();
    if (id) {
      this.chat.clearConversation(id);
    }
    this.cancelClearConversation();
  }
}
