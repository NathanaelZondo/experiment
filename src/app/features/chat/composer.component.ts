import { Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChatGenerationService } from '../../core/chat-generation.service';
import { ConversationStore } from '../../core/conversation.store';
import { Button } from '../../shared/ui/button.component';
import { Tooltip } from '../../shared/ui/tooltip.component';

/**
 * Multiline composer: Enter sends, Shift+Enter inserts a newline.
 * Sending is disabled (with an explanatory hint) when no model is loaded, when
 * no conversation is active, or while a response is already in flight; while
 * generating the send button becomes a stop-generation control backed by
 * AbortController.
 */
@Component({
  selector: 'app-composer',
  imports: [FormsModule, Button, Tooltip],
  templateUrl: './composer.component.html',
  styleUrl: './composer.component.scss'
})
export class Composer {
  private readonly service = inject(ChatGenerationService);
  private readonly conversations = inject(ConversationStore);

  protected readonly text = signal('');
  protected readonly generating = this.service.isActive;
  /** Reactive send guard (reads signals → recomputes on state changes). */
  protected readonly canSend = computed(() => {
    const guard = this.service.canSend();
    if (!guard.ok) return guard;
    // Sending into a non-existent conversation used to be silently dropped by
    // the parent — block it here with a clear hint instead.
    if (!this.conversations.active()) return { ok: false, reason: 'Start a conversation first.' };
    return guard;
  });

  /** Emitted with the trimmed user text (the parent performs the send). */
  readonly sent = output<string>();

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  send(): void {
    const value = this.text().trim();
    if (!value || !this.canSend().ok) return;
    this.sent.emit(value);
    this.text.set('');
  }

  stop(): void {
    this.service.cancel();
  }
}
