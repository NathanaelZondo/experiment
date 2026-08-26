import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatPanel } from './chat-panel.component';
import { ConversationStore } from '../../core/conversation.store';
import { ChatGenerationService } from '../../core/chat-generation.service';

/** Stub ChatGenerationService for component tests — no real fetch needed. */
class StubGenerationService {
  isActive = signal(false);
  phase = signal<string | null>(null);
  send = vi.fn(async () => null);
  canSend() {
    return { ok: true, reason: undefined };
  }
}

describe('ChatPanel component', () => {
  let fixture: ComponentFixture<ChatPanel>;
  let store: ConversationStore;

  function buttonByText(text: string): HTMLButtonElement | null {
    const buttons = Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];
    return buttons.find((b) => (b.textContent ?? '').trim() === text) ?? null;
  }

  beforeEach(async () => {
    fixture = await TestBed.configureTestingModule({
      imports: [ChatPanel],
      providers: [{ provide: ChatGenerationService, useValue: new StubGenerationService() }]
    }).compileComponents();

    fixture = TestBed.createComponent(ChatPanel);
    store = TestBed.inject(ConversationStore);
    // jsdom has no requestAnimationFrame — the auto-scroll effect needs one.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('system prompt editor (Phase 6)', () => {
    it('opens the dialog prefilled with the conversation system prompt', async () => {
      const conv = store.createConversation();
      store.setSystemPrompt(conv.id, 'Existing prompt.');
      fixture.detectChanges();

      buttonByText('System prompt')!.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeTruthy();
      const textarea = fixture.nativeElement.querySelector('app-textarea textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Existing prompt.');
    });

    it('saves the edited prompt (trimmed) to the active conversation and closes the dialog', () => {
      const conv = store.createConversation();
      fixture.detectChanges();

      buttonByText('System prompt')!.click();
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('app-textarea textarea') as HTMLTextAreaElement;
      textarea.value = '  You are terse.  ';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();

      buttonByText('Save')!.click();
      fixture.detectChanges();

      const updated = store.conversations().find((c) => c.id === conv.id)!;
      expect(updated.systemPrompt).toBe('You are terse.');
      expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    });

    it('cancels without changing the stored prompt', () => {
      const conv = store.createConversation();
      store.setSystemPrompt(conv.id, 'Keep me.');
      fixture.detectChanges();

      buttonByText('System prompt')!.click();
      fixture.detectChanges();

      const textarea = fixture.nativeElement.querySelector('app-textarea textarea') as HTMLTextAreaElement;
      textarea.value = 'Changed';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      fixture.detectChanges();

      buttonByText('Cancel')!.click();
      fixture.detectChanges();

      const updated = store.conversations().find((c) => c.id === conv.id)!;
      expect(updated.systemPrompt).toBe('Keep me.');
    });
  });

  describe('sending without an active conversation', () => {
    it('auto-creates a conversation so the message is never silently dropped', async () => {
      const service = TestBed.inject(ChatGenerationService) as unknown as StubGenerationService;
      expect(store.conversations()).toHaveLength(0);

      (fixture.componentInstance as unknown as { onSend: (text: string) => void }).onSend('Hello there');
      await fixture.whenStable();

      expect(store.conversations()).toHaveLength(1);
      expect(store.active()).not.toBeNull();
      expect(service.send).toHaveBeenCalledWith(store.active()!.id, 'Hello there');
    });

    it('sends into the existing active conversation without creating a duplicate', async () => {
      const service = TestBed.inject(ChatGenerationService) as unknown as StubGenerationService;
      const conv = store.createConversation();
      fixture.detectChanges();

      (fixture.componentInstance as unknown as { onSend: (text: string) => void }).onSend('Hi');
      await fixture.whenStable();

      expect(store.conversations()).toHaveLength(1);
      expect(service.send).toHaveBeenCalledWith(conv.id, 'Hi');
    });
  });
});
