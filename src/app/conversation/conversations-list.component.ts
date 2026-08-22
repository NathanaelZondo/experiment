import { Component, OnInit } from '@angular/core';
import { ConversationService, Conversation } from '../conversation.service';
import { ConversationListItemComponent } from './conversation-list-item.component';

@Component({
  selector: 'app-conversations-list',
  standalone: true,
  imports: [ConversationListItemComponent],
  template: `
    @if (service.firstUse) {
      <div class="empty-state">
        <p>No conversations yet.</p>
        <button class="btn-primary" (click)="createNew()">
          Start New Conversation
        </button>
      </div>
    } @else {
      <ul class="conversations-list">
        @for (conv of service.getAllConversations(); track conv.id) {
          <app-conversation-list-item
            [conversation]="conv"
            (select)="selectConversation($event)"
          ></app-conversation-list-item>
        }
      </ul>
    }
  `,
  styles: [
    `
      .empty-state {
        padding: var(--spacing-8);
        text-align: center;
        color: var(--color-fg);
        opacity: 0.5;
      }

      .btn-primary {
        padding: var(--spacing-3) var(--spacing-4);
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: var(--spacing-2);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: background var(--transition-normal);
      }

      .btn-primary:hover {
        background: var(--color-primary-dark);
      }

      .conversations-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-2);
        max-height: 400px;
        overflow-y: auto;
      }

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
export class ConversationsListComponent implements OnInit {
  constructor(public service: ConversationService) {}

  ngOnInit(): void {
    // No initialization needed - signals are reactive
  }

  createNew(): void {
    this.service.createConversation();
  }

  selectConversation(id: string): void {
    this.service.selectConversation(id);
  }
}