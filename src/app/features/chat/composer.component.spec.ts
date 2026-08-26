import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Composer } from './composer.component';
import { ChatGenerationService } from '../../core/chat-generation.service';
import { ConversationStore } from '../../core/conversation.store';
import { Button } from '../../shared/ui/button.component';
import { Tooltip } from '../../shared/ui/tooltip.component';

/** Stub ChatGenerationService for component tests — no real fetch needed. */
class StubGenerationService {
  isActive = signal(false);
  canSendValue = signal({ ok: true as boolean, reason: '' as string | undefined });
  canSend() { return this.canSendValue(); }
  cancel() { this.cancelled = true; }
  cancelled = false;
}

describe('Composer component', () => {
  let fixture: ComponentFixture<Composer>;
  let component: Composer;
  let stub: StubGenerationService;
  let store: ConversationStore;

  beforeEach(async () => {
    stub = new StubGenerationService();
    fixture = await TestBed.configureTestingModule({
      imports: [Composer, FormsModule, Button, Tooltip],
      providers: [{ provide: ChatGenerationService, useValue: stub }]
    }).compileComponents();

    store = TestBed.inject(ConversationStore);
    store.createConversation(); // active conversation so the send guard passes

    fixture = TestBed.createComponent(Composer);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  function textarea(): HTMLTextAreaElement {
    return fixture.nativeElement.querySelector('.composer__input');
  }

  function sendButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('app-button button.lb-btn--primary');
  }

  function stopButton(): HTMLButtonElement | null {
    return fixture.nativeElement.querySelector('app-button button.lb-btn--danger');
  }

  function hint(): string | null {
    const el = fixture.nativeElement.querySelector('.composer__hint');
    return el ? el.textContent : null;
  }

  it('renders the textarea with the placeholder', () => {
    expect(textarea()).toBeTruthy();
    expect(textarea().placeholder).toContain('Ask your local model');
  });

  it('emits the trimmed text on Enter keydown', async () => {
    const sentSpy = vi.spyOn(component.sent, 'emit');
    // Update the signal directly so canSend() and text() are in sync.
    (component as any).text.set('  Hello world  ');
    await fixture.whenStable();

    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: false, bubbles: true, cancelable: true });
    Object.defineProperty(event, 'isComposing', { value: false });
    textarea().dispatchEvent(event);

    expect(sentSpy).toHaveBeenCalledWith('Hello world');
    expect((component as any).text()).toBe(''); // cleared after send
  });

  it('does NOT send when Shift+Enter is pressed', () => {
    const sentSpy = vi.spyOn(component.sent, 'emit');
    (component as any).text.set('Hello');
    const event = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true });
    Object.defineProperty(event, 'isComposing', { value: false });
    textarea().dispatchEvent(event);

    expect(sentSpy).not.toHaveBeenCalled();
  });

  it('disables the send button when canSend() returns false', async () => {
    stub.canSendValue.set({ ok: false, reason: 'No model loaded' });
    fixture.detectChanges();
    await fixture.whenStable();
    const btn = sendButton();
    expect(btn?.disabled).toBe(true);
    expect(hint()).toBe('No model loaded');
  });

  it('disables the send button when the text area is empty', async () => {
    stub.canSendValue.set({ ok: true, reason: undefined });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(sendButton()?.disabled).toBe(true);
  });

  it('enables the send button when canSend is true and text is non-empty', async () => {
    stub.canSendValue.set({ ok: true, reason: undefined });
    (component as any).text.set('Hello');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(sendButton()?.disabled).toBe(false);
  });

  it('disables send with a hint when there is no active conversation', async () => {
    store.deleteConversation(store.active()!.id);
    fixture.detectChanges();
    await fixture.whenStable();
    const btn = sendButton();
    expect(btn?.disabled).toBe(true);
    expect(hint()).toBe('Start a conversation first.');
  });

  it('emits cancel when the stop button is clicked', async () => {
    stub.isActive.set(true);
    fixture.detectChanges();
    await fixture.whenStable();

    const stopBtn = stopButton();
    expect(stopBtn).toBeTruthy();
    stopBtn!.click();

    expect(stub.cancelled).toBe(true);
  });

  it('shows the stop button while generating', async () => {
    stub.isActive.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(stopButton()).toBeTruthy();
    expect(sendButton()).toBeNull();

    stub.isActive.set(false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(sendButton()).toBeTruthy();
    expect(stopButton()).toBeNull();
  });
});
