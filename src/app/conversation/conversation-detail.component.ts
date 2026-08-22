import { Component, OnInit } from '@angular/core';
import { ConversationService, Message } from '../conversation.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    @if (!service.selectedId()) {
      <div class="empty-state">
        <p>Select a conversation to view messages.</p>
      </div>
    } @else {
      <div class="conversation-detail">
        <!-- System Prompt Section -->
        <div class="system-prompt-section">
          <label class="system-prompt-label">System Prompt</label>
          <textarea
            class="system-prompt-input"
            [(ngModel)]="serviceSelectedPrompt"
            (input)="onSystemPromptChange($event)"
            rows="3"
            placeholder="Enter system prompt..."
          ></textarea>
        </div>

        <!-- Messages List -->
        <div class="messages-list" *ngIf="service.getMessages().length > 0">
          @for (message of service.getMessages(); track message.content) {
            <div
              class="
                message
                @if (message.role === 'user') { user-message; }
                @else { assistant-message; }
              "
            >
              {{ message.content }}
            </div>
          }
        </div>

        <!-- Empty chat state -->
        @if (service.getMessages().length === 0) {
          <div class="empty-chat">
            <p>No messages yet. Start by sending a message.</p>
          </div>
        }

        <!-- Message Input -->
        <div class="message-input-area">
          <input
            type="text"
            class="message-input"
            [(ngModel)]="newMessage"
            (keyup.enter)="sendMessage()"
            placeholder="Type your message..."
            autocomplete="off"
          />
          <button class="send-button" (click)="sendMessage()">Send</button>
        </div>
      </div>
    }
  `,
  styles: [
    `
      .conversation-detail {
        padding: var(--spacing-4);
      }

      .system-prompt-section {
        margin-bottom: var(--spacing-4);
        padding: var(--spacing-3);
        background: var(--bg-subtle);
        border-radius: var(--spacing-2);
      }

      .system-prompt-label {
        display: block;
        font-size: var(--font-size-sm);
        color: var(--color-fg);
        margin-bottom: var(--spacing-2);
      }

      .system-prompt-input {
        width: 100%;
        padding: var(--spacing-2) var(--spacing-3);
        border: 1px solid var(--border);
        border-radius: var(--spacing-2);
        background: var(--bg);
        color: var(--color-fg);
        font-size: var(--font-size-sm);
        resize: vertical;
      }

      .system-prompt-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
      }

      .messages-list {
        display: flex;
        flex-direction: column;
        gap: var(--spacing-3);
        max-height: 400px;
        overflow-y: auto;
        padding-right: var(--spacing-4);
      }

      .message {
        max-width: 80%;
        padding: var(--spacing-2) var(--spacing-3);
        border-radius: var(--spacing-2);
        font-size: var(--font-size-sm);
        line-height: 1.4;
      }

      .user-message {
        align-self: flex-end;
        background: var(--color-primary);
        color: white;
        margin-left: auto;
      }

      .assistant-message {
        align-self: flex-start;
        background: var(--bg-subtle);
        color: var(--color-fg);
      }

      .empty-chat {
        padding: var(--spacing-8);
        text-align: center;
        color: var(--color-fg);
        opacity: 0.5;
        font-style: italic;
      }

      .message-input-area {
        display: flex;
        gap: var(--spacing-3);
        margin-top: var(--spacing-4);
        padding-top: var(--spacing-4);
        border-top: 1px solid var(--border);
      }

      .message-input {
        flex: 1;
        padding: var(--spacing-2) var(--spacing-3);
        border: 1px solid var(--border);
        border-radius: var(--spacing-2);
        background: var(--bg);
        color: var(--color-fg);
        font-size: var(--font-size-sm);
        resize: none;
      }

      .message-input:focus {
        outline: none;
        border-color: var(--color-primary);
      }

      .send-button {
        padding: var(--spacing-3) var(--spacing-4);
        background: var(--color-primary);
        color: white;
        border: none;
        border-radius: var(--spacing-2);
        font-size: var(--font-size-sm);
        cursor: pointer;
        transition: background var(--transition-normal);
      }

      .send-button:hover {
        background: var(--color-primary-dark);
      }
    `,
  ],
})
export class ConversationDetailComponent implements OnInit {
  newMessage = '';
  serviceSelectedPrompt = '';

  constructor(public service: ConversationService) {}

  ngOnInit(): void {}

  onSystemPromptChange(event: any): void {
    const value = event.target?.value ?? '';
    this.service.setSystemPrompt(value);
  }

  sendMessage(): void {
    if (!this.newMessage.trim() || !this.service.selectedId()) return;

    // Add user message to the current conversation
    this.service.addUserMessage(this.newMessage);

    // TODO: In a real app, this would call an API and add assistant response
    // For now, we'll simulate an assistant response after a short delay
    setTimeout(() => {
      this.service.addAssistantMessage(
        'This is a simulated AI response to: "' + this.newMessage.trim() + '"',
      );
    }, 500);

    this.newMessage = '';
  }
}