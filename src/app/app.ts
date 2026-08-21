import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DOCUMENT } from '@angular/common';
import { ConversationStore } from './conversation-store';
import { ThemeService } from './theme.service';
import { Sidebar } from './sidebar';
import { ChatPanel } from './chat-panel';
import { SettingsPanel } from './settings-panel';
import { Dialog } from './design-system/dialog';
import { Button } from './design-system/button';
import { Icon } from './design-system/icon';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, Sidebar, ChatPanel, SettingsPanel, Dialog, Button, Icon],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  private readonly store = inject(ConversationStore);
  readonly themeService = inject(ThemeService);
  private readonly documentRef = inject(DOCUMENT);

  /** Sidebar visible as a column on desktop, off-canvas drawer below 1024px. */
  sidebarOpen = this.isDesktop();
  /** Settings visible as a column on desktop, off-canvas drawer below 1024px. */
  settingsOpen = this.isDesktop();

  /** Id of the conversation awaiting delete confirmation, or null. */
  pendingDeleteId: string | null = null;

  constructor() {
    // Apply the theme to <html> and keep it in sync — RAM only.
    effect(() => {
      const theme = this.themeService.theme();
      if (theme === 'dark') {
        this.documentRef.documentElement.setAttribute('data-theme', 'dark');
      } else {
        this.documentRef.documentElement.removeAttribute('data-theme');
      }
    });
  }

  toggleSidebar(): void {
    this.sidebarOpen = !this.sidebarOpen;
  }

  toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
  }

  /** Called by the sidebar when a non-empty conversation is deleted. */
  onRequestDelete(id: string): void {
    this.pendingDeleteId = id;
  }

  confirmDelete(): void {
    if (this.pendingDeleteId) {
      this.store.delete(this.pendingDeleteId);
    }
    this.pendingDeleteId = null;
  }

  cancelDelete(): void {
    this.pendingDeleteId = null;
  }

  get pendingConversationTitle(): string {
    return this.store.get(this.pendingDeleteId)?.title ?? 'this conversation';
  }

  private isDesktop(): boolean {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(min-width: 1024px)').matches;
    }
    return true;
  }
}
