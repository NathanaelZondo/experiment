import { Component, OnInit } from '@angular/core';
import { ConversationService, Conversation } from '../conversation.service';
import { ConversationsListComponent } from './conversations-list.component';
import { ConversationDetailComponent } from './conversation-detail.component';

@Component({
  selector: 'app-conversation',
  standalone: true,
  imports: [ConversationsListComponent, ConversationDetailComponent],
  template: `
    <div class="conversation-container">
      <!-- Conversations List Sidebar -->
      <aside class="conversations-sidebar">
        <h3 class="sidebar-title">Conversations</h3>
        <app-conversations-list (select)="onConversationSelect($event)" />
        @if (!service.firstUse) {
          <div class="new-conversation-bar">
            <button class="new-conv-btn" (click)="createNewConversation()">
              New Conversation
            </button>
          </div>
        }
      </aside>

      <!-- Active Conversation Detail -->
      <main class="conversation-main">
        <app-conversation-detail />
      </main>
    </div>
  `,
  styles: [
    `
      .conversation-container {
        display: flex;
        width: 100%;
      }

      .conversations-sidebar {
        flex: 0 0 300px;
        padding: var(--spacing-6);
        border-right: 1px solid var(--border);
        height: fit-content;
        y-index: 100;
      }

      .sidebar-title {
        font-size: var(--font-size-md);
        color: var(--color-fg);
        margin-bottom: var(--spacing-4);
        padding-bottom: var(--spacing-2);
        border-bottom: 1px solid var(--border);
      }

      .new-conversation-bar {
        margin-top: var(--spacing-4);
        display: flex;
        gap: var(--spacing-2);
      }

      .new-conv-btn {
        padding: var(--spacing-2) var(--spacing-3);
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: var(--spacing-2);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: background var(--transition-normal);
      }

      .new-conv-btn:hover {
        background: var(--color-primary-dark);
      }

      .conversation-main {
        flex: 1;
        padding: var(--spacing-6);
        overflow-y: auto;
      }
    `,
  ],
})
export class ConversationComponent implements OnInit {
  constructor(public service: ConversationService) {}

  ngOnInit(): void {
    // No initialization needed - signals are reactive
  }

  createNewConversation(): void {
    this.service.createConversation();
  }

  onConversationSelect(id: string): void {
    this.service.selectConversation(id);
  }
}