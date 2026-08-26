import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { SettingsStore } from './core/settings.store';
import { ConnectionStore } from './core/connection.store';
import { ChatSessionStore } from './core/chat-session.store';
import { ModelLifecycleStore } from './core/model-lifecycle.store';
import { ConversationStore } from './core/conversation.store';
import { Tooltip } from './shared/ui/tooltip.component';
import { StatusBadge } from './shared/ui/status-badge.component';
import { IconButton } from './shared/ui/icon-button.component';
import { ConversationSidebar } from './features/conversations/conversation-sidebar.component';
import { ChatPanel } from './features/chat/chat-panel.component';
import { ModelPane } from './features/model-pane/model-pane.component';

describe('App shell', () => {
  let fixture: ComponentFixture<App>;
  let component: App;
  let settingsStore: SettingsStore;

  beforeEach(async () => {
    fixture = await TestBed.configureTestingModule({
      imports: [App, Tooltip, StatusBadge, IconButton, ConversationSidebar, ChatPanel, ModelPane],
      providers: [
        SettingsStore,
        ConnectionStore,
        ChatSessionStore,
        ModelLifecycleStore,
        provideRouter([]),
        // Mirrors app.config.ts — MessageItem renders chat bubbles and requires
        // Navigator for its clipboard.
        { provide: Navigator, useValue: navigator }
      ]
    }).compileComponents();

    // jsdom has no requestAnimationFrame — the chat auto-scroll effect needs one.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));

    fixture = TestBed.createComponent(App);
    component = fixture.componentInstance;
    settingsStore = TestBed.inject(SettingsStore);
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create the app', () => {
    expect(component).toBeTruthy();
  });

  it('renders the skip link', () => {
    const skipLink = fixture.nativeElement.querySelector('.skip-link');
    expect(skipLink).toBeTruthy();
    expect(skipLink!.textContent).toContain('Skip to');
  });

  it('renders the three-panel layout (sidebar, main, aside)', () => {
    const panels = fixture.nativeElement.querySelector('.panels');
    expect(panels).toBeTruthy();
    // The grid should contain the sidebar, main chat panel, and model pane.
    const sidebar = fixture.nativeElement.querySelector('app-conversation-sidebar');
    const chatPanel = fixture.nativeElement.querySelector('app-chat-panel');
    const modelPane = fixture.nativeElement.querySelector('app-model-pane');
    expect(sidebar).toBeTruthy();
    expect(chatPanel).toBeTruthy();
    expect(modelPane).toBeTruthy();
  });

  it('starts with the dark theme applied to <html>', () => {
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('toggles the theme to light and back', async () => {
    (component as any).toggleTheme();
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    (component as any).toggleTheme();
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('shows a status badge reflecting the connection state', () => {
    const badge = fixture.nativeElement.querySelector('app-status-badge');
    expect(badge).toBeTruthy();
  });

  it('drawer toggles are present in the topbar', () => {
    const leftToggle = fixture.nativeElement.querySelector('[aria-label="Toggle conversations panel"]');
    const rightToggle = fixture.nativeElement.querySelector('[aria-label="Toggle model panel"]');
    expect(leftToggle).toBeTruthy();
    expect(rightToggle).toBeTruthy();
  });

  it('closes both drawers when the close-drawers action is triggered', () => {
    (component as any).leftOpen.set(true);
    (component as any).rightOpen.set(true);
    (component as any).closeDrawers();
    expect((component as any).leftOpen()).toBe(false);
    expect((component as any).rightOpen()).toBe(false);
  });

  it('statusState returns disconnected when not connected or generating', () => {
    expect((component as any).statusState).toBe('disconnected');
  });

  it('renders chat messages (regression: MessageItem requires the Navigator provider)', async () => {
    const conversations = TestBed.inject(ConversationStore);
    const conv = conversations.createConversation();
    conversations.addMessage(conv.id, { role: 'user', content: 'Hello there', status: 'completed' });
    conversations.addMessage(conv.id, {
      role: 'assistant',
      content: 'Wassup! How can I help?',
      status: 'completed'
    });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The bubbles render via MessageItem — this would throw NG0201 without the
    // Navigator provider from app.config.ts.
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Hello there');
    expect(text).toContain('Wassup! How can I help?');
  });
});
