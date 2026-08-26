import { Component, effect, inject, signal } from '@angular/core';
import { SettingsStore } from './core/settings.store';
import { ConnectionStore } from './core/connection.store';
import { ChatSessionStore } from './core/chat-session.store';
import { ModelLifecycleStore } from './core/model-lifecycle.store';
import { StatusBadge, type BadgeState } from './shared/ui/status-badge.component';
import { IconButton } from './shared/ui/icon-button.component';
import { Tooltip } from './shared/ui/tooltip.component';
import { ConversationSidebar } from './features/conversations/conversation-sidebar.component';
import { ChatPanel } from './features/chat/chat-panel.component';
import { ModelPane } from './features/model-pane/model-pane.component';

/**
 * Application shell: three-panel local-AI workstation layout.
 *
 * Layout contract (fixes the model-pane overflow issue):
 *  - The centre conversation column is `minmax(0,1fr)` so it can never be
 *    displaced by content in either side panel.
 *  - Every panel has a bounded height (`min-height: 0`) with its own internal
 *    scroll regions; the model catalogue scrolls inside the right-hand panel.
 *  - Below 1024px the left and right panels become off-canvas drawers.
 */
@Component({
  selector: 'app-root',
  imports: [StatusBadge, IconButton, Tooltip, ConversationSidebar, ChatPanel, ModelPane],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly settings = inject(SettingsStore);
  private readonly connections = inject(ConnectionStore);
  private readonly session = inject(ChatSessionStore);
  private readonly lifecycle = inject(ModelLifecycleStore);

  /** Theme (RAM only) — applied to <html> in the constructor effect. */
  protected readonly theme = this.settings.theme;

  /** Drawer state (used on tablet/mobile where side panels become drawers). */
  readonly leftOpen = signal(false);
  readonly rightOpen = signal(false);

  constructor() {
    // Theme is held in RAM only; apply it to <html> so tokens cascade.
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.settings.theme());
    });
  }

  protected get statusState(): BadgeState {
    if (this.session.active) return 'generating';
    const loading = this.lifecycle.loading();
    if (loading !== null) return 'loading';
    switch (this.connections.status()) {
      case 'connected':
        return 'connected';
      case 'checking':
        return 'checking';
      case 'failed':
        return 'failed';
      default:
        return 'disconnected';
    }
  }

  protected toggleTheme(): void {
    this.settings.toggleTheme();
  }

  protected closeDrawers(): void {
    this.leftOpen.set(false);
    this.rightOpen.set(false);
  }
}
