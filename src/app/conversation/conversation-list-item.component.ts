import { Component, Input, output } from '@angular/core';
import { ConversationService, Conversation } from '../conversation.service';

@Component({
  selector: 'app-conversation-list-item',
  standalone: true,
  imports: [],
  template: `
    <button
      class="conversation-item"
      (click)="select.emit(conversation.id)"
      [class.active]="isActive"
    >
      <span class="conversation-title">{{ conversation.title }}</span>
      @if (conversation.messages.length > 0) {
        <span class="conversation-message-count">({{ conversation.messages.length }})</span>
      }
    </button>
  `,
  styles: [
    `
      .conversation-item {
        display: flex;
        align-items: center;
        padding: var(--spacing-2) var(--spacing-3);
        color: var(--color-fg);
        text-decoration: none;
        border-radius: var(--spacing-2);
        font-size: var(--font-size-sm);
        transition: background var(--transition-normal), color var(--transition-normal);
      }

      .conversation-item:hover {
        background: var(--bg-subtle);
        color: var(--color-primary);
      }

      .conversation-item.active {
        background: var(--color-primary);
        color: white;
      }

      .conversation-message-count {
        margin-left: var(--spacing-2);
        opacity: 0.7;
        font-size: var(--font-size-xs);
      }
    `,
  ],
})
export class ConversationListItemComponent {
  @Input() conversation!: Conversation;

  select = output<string>();

  constructor(public service: ConversationService) {}

  get isActive(): boolean {
    const selectedId = this.service.selectedId();
    return selectedId ? selectedId === this.conversation.id : false;
  }
