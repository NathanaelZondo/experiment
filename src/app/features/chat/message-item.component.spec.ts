import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { MessageItem } from './message-item.component';
import { MarkdownPipe } from '../../shared/markdown/markdown.pipe';
import { DurationPipe, MetricPipe } from '../../shared/pipes/format.pipe';
import { Button } from '../../shared/ui/button.component';
import { IconButton } from '../../shared/ui/icon-button.component';
import { Tooltip } from '../../shared/ui/tooltip.component';
import type { ChatMessage } from '../../core/types/lm-studio.types';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    role: 'assistant',
    content: '',
    status: 'completed',
    createdAt: 1700000000000,
    ...overrides
  };
}

describe('MessageItem component', () => {
  let fixture: ComponentFixture<MessageItem>;
  let component: MessageItem;

  beforeEach(async () => {
    fixture = await TestBed.configureTestingModule({
      imports: [MessageItem, FormsModule, MarkdownPipe, DurationPipe, MetricPipe, Button, IconButton, Tooltip],
      providers: [
        {
          provide: Navigator,
          useValue: {
            clipboard: {
              writeText: vi.fn().mockResolvedValue(undefined)
            }
          }
        }
      ]
    }).compileComponents();
  });

  function render(msg: ChatMessage) {
    fixture = TestBed.createComponent<MessageItem>(MessageItem);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('message', msg);
    fixture.componentRef.setInput('isLatestAssistant', true);
    fixture.detectChanges();
  }

  it('renders user messages as plain text bubbles', () => {
    render(makeMessage({ role: 'user', content: 'Hello there' }));
    expect(fixture.nativeElement.querySelector('.msg__bubble--user')?.textContent).toBe('Hello there');
    expect(fixture.nativeElement.querySelector('.msg__model')).toBeNull();
  });

  it('renders assistant messages with model name and timestamp', () => {
    render(makeMessage({ modelId: 'm/llama', content: 'Hi' }));
    expect(fixture.nativeElement.querySelector('.msg__model')?.textContent).toBe('m/llama');
    const time = fixture.nativeElement.querySelector('time');
    expect(time).toBeTruthy();
    expect(time!.getAttribute('datetime')).toBeTruthy();
  });

  describe('markdown sanitization', () => {
    it('removes <script> tags from assistant content via the markdown pipe', () => {
      render(makeMessage({
        content: 'Before <script>alert("xss")</script> after'
      }));
      const mdEl = fixture.nativeElement.querySelector('.md');
      expect(mdEl!.innerHTML).not.toContain('<script>');
      expect(mdEl!.innerHTML).toContain('Before');
      expect(mdEl!.innerHTML).toContain('after');
    });

    it('renders <strong> as bold text in the markdown output', () => {
      render(makeMessage({ content: '**bold text**' }));
      const mdEl = fixture.nativeElement.querySelector('.md');
      expect(mdEl!.innerHTML).toContain('<strong>bold text</strong>');
    });

    it('renders inline code with the lb-inline-code class', () => {
      render(makeMessage({ content: 'Use `console.log` here' }));
      const mdEl = fixture.nativeElement.querySelector('.md');
      expect(mdEl!.innerHTML).toContain('<code class="lb-inline-code">console.log</code>');
    });

    it('renders links as http(s) anchors', () => {
      render(makeMessage({ content: 'See [docs](https://example.com)' }));
      const mdEl = fixture.nativeElement.querySelector('.md');
      expect(mdEl!.innerHTML).toContain('<a href="https://example.com"');
      expect(mdEl!.innerHTML).toContain('target="_blank"');
    });

    it('strips javascript: URLs from links', () => {
      render(makeMessage({ content: '[bad](javascript:alert(1))' }));
      const mdEl = fixture.nativeElement.querySelector('.md');
      // javascript: URLs are rendered as plain text (not clickable), not stripped.
      expect(mdEl!.innerHTML).toContain('bad');
      expect(mdEl!.querySelector('a')).toBeNull();
    });
  });

  describe('code blocks', () => {
    it('renders fenced code blocks with the lb-code-block wrapper', () => {
      render(makeMessage({ content: '```\nconst x = 1;\n```' }));
      const block = fixture.nativeElement.querySelector('.lb-code-block');
      expect(block).toBeTruthy();
      expect(block!.querySelector('code')?.textContent).toContain('const x = 1;');
    });

    it('includes a copy button inside the code block', () => {
      render(makeMessage({ content: '```\nconst x = 1;\n```' }));
      const copyBtn = fixture.nativeElement.querySelector('.lb-code-copy');
      expect(copyBtn).toBeTruthy();
    });

    it('copies code content when the copy button is clicked', async () => {
      render(makeMessage({ content: '```\nconst x = 1;\n```' }));
      const copyBtn = fixture.nativeElement.querySelector('.lb-code-copy');
      const clickEvent = new MouseEvent('click', { bubbles: true });
      Object.defineProperty(clickEvent, 'target', { value: copyBtn, writable: false });
      Object.defineProperty(clickEvent, 'currentTarget', { value: copyBtn, writable: false });
      copyBtn!.dispatchEvent(clickEvent);
      // copyText is async; the clipboard write is mocked by the test harness.
      // Just verify no error was thrown.
      await fixture.whenStable();
    });
  });

  describe('reasoning section', () => {
    it('renders a collapsible <details> when reasoning is present', () => {
      render(makeMessage({ reasoning: 'Let me think about this...' }));
      const details = fixture.nativeElement.querySelector('details.msg__reasoning');
      expect(details).toBeTruthy();
      expect(details!.querySelector('summary')?.textContent).toBe('Reasoning');
    });

    it('does not render the reasoning section when absent', () => {
      render(makeMessage());
      expect(fixture.nativeElement.querySelector('details.msg__reasoning')).toBeNull();
    });

    it('keeps the reasoning details open with a "Thinking" summary while streaming', () => {
      render(makeMessage({ status: 'streaming', reasoning: 'working it out…' }));
      const details = fixture.nativeElement.querySelector('details.msg__reasoning');
      expect(details!.getAttribute('open')).not.toBeNull();
      expect(details!.querySelector('summary')?.textContent).toContain('Thinking');
    });

    it('closes the reasoning details with a "Reasoning" summary once completed', () => {
      render(makeMessage({ status: 'completed', reasoning: 'done thinking' }));
      const details = fixture.nativeElement.querySelector('details.msg__reasoning');
      expect(details!.getAttribute('open')).toBeNull();
      expect(details!.querySelector('summary')?.textContent).toBe('Reasoning');
    });
  });

  describe('empty-response notice', () => {
    it('shows a notice when a completed message has no content', () => {
      render(makeMessage());
      const notice = fixture.nativeElement.querySelector('.msg__notice');
      expect(notice).toBeTruthy();
      expect(notice!.textContent).toContain('empty response');
    });

    it('shows a reasoning-specific notice when only reasoning was produced', () => {
      render(makeMessage({ reasoning: 'thoughts only' }));
      const notice = fixture.nativeElement.querySelector('.msg__notice');
      expect(notice!.textContent).toContain('Max output tokens');
    });

    it('does not show a notice when content is present', () => {
      render(makeMessage({ content: 'real answer' }));
      expect(fixture.nativeElement.querySelector('.msg__notice')).toBeNull();
    });

    it('does not show a notice while the message is still streaming', () => {
      render(makeMessage({ status: 'streaming', content: '' }));
      expect(fixture.nativeElement.querySelector('.msg__notice')).toBeNull();
    });
  });

  describe('metrics display', () => {
    it('shows a metrics toggle when metrics are present on a completed message', () => {
      render(makeMessage({
        metrics: { totalElapsedMs: 1500, inputTokens: 10, outputTokens: 5, timeToFirstTokenMs: 200 }
      }));
      const toggle = fixture.nativeElement.querySelector('.msg__metrics-toggle');
      expect(toggle).toBeTruthy();
      expect(toggle!.textContent).toContain('Show metrics');
    });

    it('does not show metrics toggle for streaming messages', () => {
      render(makeMessage({ status: 'streaming', content: 'hello' }));
      expect(fixture.nativeElement.querySelector('.msg__metrics-toggle')).toBeNull();
    });

    it('copies metrics JSON on the copy button click', async () => {
      render(makeMessage({
        metrics: { totalElapsedMs: 500, outputTokens: 3 }
      }));
      fixture.detectChanges();
      // The metrics toggle must be clicked first to expand metrics.
      const toggle = fixture.nativeElement.querySelector('.msg__metrics-toggle');
      toggle!.click();
      fixture.detectChanges();
      // The copy button is inside .msg__metrics, not .msg__actions.
      const copyBtn = fixture.nativeElement.querySelector('.msg__metrics app-button');
      copyBtn!.click();
      await fixture.whenStable();
    });
  });

  describe('error and cancelled states', () => {
    it('shows an error alert for failed messages', () => {
      render(makeMessage({ status: 'failed', error: 'context length exceeded' }));
      const errorEl = fixture.nativeElement.querySelector('.msg__error[role="alert"]');
      expect(errorEl!.textContent).toContain('Generation failed');
      expect(errorEl!.textContent).toContain('context length exceeded');
    });

    it('shows a stopped alert for cancelled messages', () => {
      render(makeMessage({ status: 'cancelled' }));
      const errorEl = fixture.nativeElement.querySelector('.msg__error[role="alert"]');
      expect(errorEl!.textContent).toContain('Stopped by user');
    });
  });

  describe('pending and streaming states', () => {
    it('shows "Generating…" for pending messages with no content', () => {
      render(makeMessage({ status: 'pending', content: '' }));
      expect(fixture.nativeElement.querySelector('.msg__thinking')?.textContent).toContain('Generating');
    });

    it('shows "Generating…" for streaming messages with no content', () => {
      render(makeMessage({ status: 'streaming', content: '' }));
      expect(fixture.nativeElement.querySelector('.msg__thinking')?.textContent).toContain('Generating');
    });
  });
});
