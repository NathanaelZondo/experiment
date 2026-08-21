import { ChangeDetectionStrategy, Component, ElementRef, ViewChild, inject, output, signal } from '@angular/core';
import { Conversation, ConversationStore } from './conversation-store';
import { Button } from './design-system/button';
import { IconButton } from './design-system/icon-button';
import { Icon } from './design-system/icon';
import { Tooltip } from './design-system/tooltip';
import { StatusBadge } from './design-system/status-badge';

@Component({
  selector: 'app-sidebar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Button, IconButton, Icon, Tooltip, StatusBadge],
  template: `
    <div class="sidebar">
      <div class="sidebar-header">
        <h2>Conversations</h2>
        <app-button size="sm" (click)="onNew()">
          <app-icon name="plus" [size]="14"></app-icon>
          New
        </app-button>
      </div>

      @if (store.conversations().length === 0) {
        <p class="sidebar-empty">No conversations yet. Create one to get started.</p>
      } @else {
        <ul class="conversation-list" role="listbox" aria-label="Conversations">
          @for (c of store.conversations(); track c.id; let i = $index) {
            <li
              [id]="'conv-' + c.id"
              role="option"
              [attr.aria-selected]="store.selectedId() === c.id ? true : null"
              [class.is-selected]="store.selectedId() === c.id"
              [tabIndex]="i === 0 || store.selectedId() === c.id ? 0 : -1"
              (click)="onSelect(c.id)"
              (keydown)="handleListKeydown($event, i)"
            >
              @if (editingId() === c.id) {
                <input
                  #renameInput
                  class="rename-input"
                  [value]="draftTitle()"
                  aria-label="Rename conversation"
                  (input)="onRenameInput($event)"
                  (keydown.enter)="commitRename(c.id)"
                  (keydown.escape)="cancelRename()"
                  (blur)="commitRename(c.id)"
                />
              } @else {
                <span class="conversation-title">{{ c.title }}</span>
                <span class="conversation-actions">
                  <app-tooltip text="Rename">
                    <app-icon-button label="Rename {{ c.title }}" (click)="startRename(c)">
                      <app-icon name="pencil" [size]="15"></app-icon>
                    </app-icon-button>
                  </app-tooltip>
                  <app-tooltip text="Delete">
                    <app-icon-button class="danger" label="Delete {{ c.title }}" (click)="requestDelete(c.id)">
                      <app-icon name="trash" [size]="15"></app-icon>
                    </app-icon-button>
                  </app-tooltip>
                </span>
              }
            </li>
          }
        </ul>
      }

      <div class="sidebar-footer">
        <app-status-badge tone="warning" text="Session only — refreshing clears chats"></app-status-badge>
      </div>
    </div>
  `,
  styleUrl: './sidebar.scss'
})
export class Sidebar {
  readonly store = inject(ConversationStore);

  /** Id of the conversation currently being renamed (null when not editing). */
  protected readonly editingId = signal<string | null>(null);
  protected readonly draftTitle = signal('');

  /** Emitted when a non-empty conversation should be deleted after confirmation. */
  readonly deleteRequest = output<string>();

  @ViewChild('renameInput') private renameInput?: ElementRef<HTMLInputElement>;

  onNew(): void {
    this.store.create();
  }

  onSelect(id: string): void {
    this.store.select(id);
  }

  startRename(c: Conversation): void {
    this.editingId.set(c.id);
    this.draftTitle.set(c.title);
    // Move focus into the rename field on the next frame.
    requestAnimationFrame(() => this.renameInput?.nativeElement.focus());
  }

  onRenameInput(event: Event): void {
    this.draftTitle.set((event.target as HTMLInputElement).value);
  }

  commitRename(id: string): void {
    if (this.editingId() !== id) {
      return;
    }
    const title = this.draftTitle().trim();
    if (title) {
      this.store.rename(id, title);
    }
    this.editingId.set(null);
  }

  cancelRename(): void {
    this.editingId.set(null);
  }

  requestDelete(id: string): void {
    // Empty conversations delete immediately; non-empty ones confirm first.
    if (this.store.isNonEmpty(id)) {
      this.deleteRequest.emit(id);
    } else {
      this.store.delete(id);
    }
  }

  /** Roving tabindex navigation across the listbox options. */
  handleListKeydown(event: KeyboardEvent, index: number): void {
    const items = this.store.conversations();
    let nextIndex: number | null = null;

    switch (event.key) {
      case 'ArrowDown':
        nextIndex = Math.min(index + 1, items.length - 1);
        break;
      case 'ArrowUp':
        nextIndex = Math.max(index - 1, 0);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = items.length - 1;
        break;
      case 'Enter':
        this.onSelect(items[index].id);
        event.preventDefault();
        return;
      default:
        return;
    }

    if (nextIndex === null || nextIndex === index) {
      return;
    }
    event.preventDefault();
    const target = document.getElementById(`conv-${items[nextIndex].id}`);
    target?.focus();
  }
}
