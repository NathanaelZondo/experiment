import { Component, effect, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConversationStore } from '../../core/conversation.store';
import { Button } from '../../shared/ui/button.component';
import { IconButton } from '../../shared/ui/icon-button.component';
import { Dialog } from '../../shared/ui/dialog.component';
import { EmptyState } from '../../shared/ui/empty-state.component';

/**
 * Left panel: conversation list with new-chat, rename and delete controls.
 * Deleting a non-empty conversation requires confirmation. All data is in RAM —
 * the "Session only" indicator makes that explicit to users.
 */
@Component({
  selector: 'app-conversation-sidebar',
  imports: [FormsModule, Button, IconButton, Dialog, EmptyState],
  templateUrl: './conversation-sidebar.component.html',
  styleUrl: './conversation-sidebar.component.scss'
})
export class ConversationSidebar {
  private readonly store = inject(ConversationStore);

  /** Emitted after a conversation is selected (used to close the mobile drawer). */
  readonly selected = output<void>();

  protected readonly conversations = this.store.conversations;
  protected readonly activeId = this.store.activeId;

  /* ------------------------------ local UI state ----------------------------- */

  protected readonly renamingId = signal<string | null>(null);
  protected readonly renameValue = signal('');
  private readonly confirmDeleteId = signal<string | null>(null);
  protected readonly deleteConfirmOpen = signal(false);

  constructor() {
    // Keep the rename buffer in sync when a rename starts.
    effect(() => {
      const id = this.renamingId();
      if (id !== null) {
        const conv = this.store.conversations().find((c) => c.id === id);
        if (conv && this.renameValue() === '') this.renameValue.set(conv.title);
      }
    });
  }

  protected get confirmTargetTitle(): string {
    const id = this.confirmDeleteId();
    return id ? (this.store.conversations().find((c) => c.id === id)?.title ?? 'conversation') : '';
  }

  protected get confirmTargetMessageCount(): number {
    const id = this.confirmDeleteId();
    return id ? (this.store.conversations().find((c) => c.id === id)?.messages.length ?? 0) : 0;
  }

  /* --------------------------------- actions -------------------------------- */

  newConversation(): void {
    this.store.createConversation();
    this.selected.emit();
  }

  select(id: string): void {
    if (this.renamingId() === id) return; // don't navigate while renaming
    this.store.select(id);
    this.selected.emit();
  }

  startRename(id: string): void {
    const conv = this.store.conversations().find((c) => c.id === id);
    if (!conv) return;
    this.renameValue.set(conv.title);
    this.renamingId.set(id);
  }

  commitRename(): void {
    const id = this.renamingId();
    if (id !== null) {
      const value = this.renameValue().trim();
      if (value.length > 0) this.store.rename(id, value);
    }
    this.renamingId.set(null);
  }

  cancelRename(): void {
    this.renamingId.set(null);
  }

  requestDelete(id: string): void {
    const conv = this.store.conversations().find((c) => c.id === id);
    if (!conv) return;
    if (conv.messages.length > 0) {
      // Confirmation required before deleting a non-empty conversation.
      this.confirmDeleteId.set(id);
      this.deleteConfirmOpen.set(true);
    } else {
      this.store.deleteConversation(id);
    }
  }

  confirmDelete(): void {
    const id = this.confirmDeleteId();
    if (id !== null) this.store.deleteConversation(id);
    this.confirmDeleteId.set(null);
    this.deleteConfirmOpen.set(false);
  }

  cancelDelete(): void {
    this.confirmDeleteId.set(null);
    this.deleteConfirmOpen.set(false);
  }
}
