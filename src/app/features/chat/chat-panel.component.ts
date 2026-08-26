import { Component, effect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConversationStore } from '../../core/conversation.store';
import { ChatGenerationService } from '../../core/chat-generation.service';
import { Composer } from './composer.component';
import { MessageItem } from './message-item.component';
import { Button } from '../../shared/ui/button.component';
import { Dialog } from '../../shared/ui/dialog.component';
import { EmptyState } from '../../shared/ui/empty-state.component';
import { TextareaField } from '../../shared/ui/textarea.component';

/**
 * Centre panel: active conversation with streamed responses and the composer.
 *
 * Auto-scrolling respects users who scroll upward: scrolling only follows new
 * content while the viewport is near the bottom; otherwise a "jump to latest"
 * affordance appears. Deleting a message truncates dependent later messages
 * (with confirmation when dependents exist). A per-conversation system prompt
 * (held in RAM) can be edited from the header.
 */
@Component({
  selector: 'app-chat-panel',
  imports: [FormsModule, Composer, MessageItem, Button, Dialog, EmptyState, TextareaField],
  templateUrl: './chat-panel.component.html',
  styleUrl: './chat-panel.component.scss'
})
export class ChatPanel {
  private readonly store = inject(ConversationStore);
  private readonly service = inject(ChatGenerationService);

  protected readonly active = this.store.active;
  protected readonly generating = this.service.isActive;
  protected readonly phase = this.service.phase;

  /** Delete-confirmation state (message id + dependent count). */
  protected readonly deleteTargetId = signal<string | null>(null);
  protected readonly deleteDependents = signal(0);
  protected readonly deleteDialogOpen = signal(false);

  /** System-prompt editor state (per conversation, held in RAM). */
  protected readonly promptDialogOpen = signal(false);
  protected readonly promptDraft = signal('');

  private readonly scroller = viewChild<HTMLDivElement>('scroller');
  /** Whether the viewport is near the bottom (follows new content). */
  private nearBottom = true;
  private lastActiveId: string | null = null;

  constructor() {
    // Follow new content while near the bottom; always jump on conversation switch.
    effect(() => {
      const conv = this.store.active();
      if (!conv) return;
      if (this.lastActiveId !== null && this.lastActiveId !== conv.id) {
        this.nearBottom = true; // new conversation → start at the bottom
      }
      this.lastActiveId = conv.id;

      const last = conv.messages[conv.messages.length - 1];
      void conv.messages.length;
      void last?.content.length;
      void last?.status;
      if (this.nearBottom) this.scheduleScrollToBottom();
    });
  }

  /** Create a fresh conversation (empty-state action). */
  newConversation(): void {
    this.store.createConversation();
  }

  protected onScroll(): void {
    const el = this.scroller();
    if (!el) return;
    this.nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  }

  protected showJumpButton(): boolean {
    return !this.nearBottom && (this.active()?.messages.length ?? 0) > 0;
  }

  jumpToLatest(): void {
    this.nearBottom = true;
    const el = this.scroller();
    if (el) el.scrollTop = el.scrollHeight;
  }

  private scheduleScrollToBottom(): void {
    requestAnimationFrame(() => {
      const el = this.scroller();
      if (el && this.nearBottom) el.scrollTop = el.scrollHeight;
    });
  }

  /* --------------------------------- actions -------------------------------- */

  onSend(text: string): void {
    let conv = this.active();
    if (!conv) {
      // No active conversation (e.g. a fresh app where the user typed before
      // clicking "New chat") — create one so the message is never silently
      // dropped.
      conv = this.store.createConversation();
    }
    void this.service.send(conv.id, text);
  }

  onEdited(messageId: string, content: string): void {
    const conv = this.active();
    if (!conv) return;
    // Discards dependent later responses and resends the revised history.
    void this.service.editAndRegenerate(conv.id, messageId, content);
  }

  onRegenerated(): void {
    const conv = this.active();
    if (!conv) return;
    void this.service.regenerateLatest(conv.id);
  }

  onDeleteRequested(messageId: string): void {
    const conv = this.active();
    if (!conv) return;
    const index = conv.messages.findIndex((m) => m.id === messageId);
    if (index === -1) return;
    const dependents = conv.messages.length - 1 - index;
    this.deleteTargetId.set(messageId);
    this.deleteDependents.set(dependents);
    // Confirmation required when dependent later messages would be removed.
    this.deleteDialogOpen.set(dependents > 0);
    if (dependents === 0) this.performDelete();
  }

  /** Confirm the pending message deletion (dialog action). */
  performDelete(): void {
    const conv = this.active();
    const id = this.deleteTargetId();
    if (!conv || id === null) return;
    this.store.deleteMessageWithDependents(conv.id, id);
    this.clearDeleteState();
  }

  cancelDelete(): void {
    this.clearDeleteState();
  }

  /** Dialog openChange handler (Esc / backdrop close cancels the deletion). */
  onDialogOpenChange(open: boolean): void {
    if (!open) this.cancelDelete();
  }

  private clearDeleteState(): void {
    this.deleteTargetId.set(null);
    this.deleteDependents.set(0);
    this.deleteDialogOpen.set(false);
  }

  protected isLatestAssistant(messageId: string): boolean {
    const conv = this.active();
    if (!conv) return false;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      const m = conv.messages[i];
      if (m.role === 'assistant') return m.id === messageId;
    }
    return false;
  }

  protected clearConversation(): void {
    const conv = this.active();
    if (!conv || this.generating()) return;
    this.store.clearMessages(conv.id);
  }

  /* --------------------------- system prompt (Phase 6) ---------------------- */

  /** Open the system-prompt editor for the active conversation. */
  openPromptDialog(): void {
    const conv = this.active();
    if (!conv) return;
    this.promptDraft.set(conv.systemPrompt);
    this.promptDialogOpen.set(true);
  }

  /** Save the edited system prompt back to the active conversation. */
  savePrompt(): void {
    const conv = this.active();
    if (!conv) return;
    this.store.setSystemPrompt(conv.id, this.promptDraft().trim());
    this.promptDialogOpen.set(false);
  }

  cancelPrompt(): void {
    this.promptDialogOpen.set(false);
  }

  /** Dialog openChange handler (Esc / backdrop close cancels the edit). */
  onPromptDialogOpenChange(open: boolean): void {
    if (!open) this.promptDialogOpen.set(false);
  }
}
