import { parseInline, renderMarkdown, safeHref } from './markdown';

describe('safeHref', () => {
  it('allows http and https URLs', () => {
    expect(safeHref('https://lmstudio.ai')).toBe('https://lmstudio.ai');
    expect(safeHref('http://localhost:1234')).toBe('http://localhost:1234');
  });

  it('rejects javascript:, data: and relative URLs', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,<script>')).toBeNull();
    expect(safeHref('/relative/path')).toBeNull();
    expect(safeHref('#anchor')).toBeNull();
  });
});

describe('parseInline', () => {
  it('parses bold, italic and inline code (empty leading text is omitted)', () => {
    const tokens = parseInline('**bold** *italic* `code`');
    expect(tokens).toEqual([
      { type: 'bold', value: 'bold' },
      { type: 'text', value: ' ' },
      { type: 'italic', value: 'italic' },
      { type: 'text', value: ' ' },
      { type: 'code', value: 'code' },
    ]);
  });

  it('parses links with allowed URLs and drops disallowed ones to plain text', () => {
    const tokens = parseInline('[site](https://example.com) [bad](javascript:x)');
    expect(tokens).toEqual([
      { type: 'link', value: 'site', href: 'https://example.com' },
      { type: 'text', value: ' [bad](javascript:x)' },
    ]);
  });

  it('keeps code span contents verbatim (no nested formatting)', () => {
    const tokens = parseInline('`**not bold**`');
    expect(tokens).toEqual([{ type: 'code', value: '**not bold**' }]);
  });
});

describe('renderMarkdown', () => {
  function render(markdown: string): HTMLElement {
    const container = document.createElement('div');
    renderMarkdown(markdown, container, document);
    return container;
  }

  it('renders headings, lists and blockquotes as the right elements', () => {
    const el = render('# Title\n- one\n- two\n1. first\n> quoted');
    expect(el.querySelector('h1')?.textContent).toBe('Title');
    expect(el.querySelectorAll('ul > li').length).toBe(2);
    expect(el.querySelectorAll('ol > li').length).toBe(1);
    expect(el.querySelector('blockquote')?.textContent).toContain('quoted');
  });

  it('renders fenced code blocks with a language label and copy button', () => {
    const el = render('```ts\nconst x = 1;\n```');
    const block = el.querySelector('.md-code');
    expect(block).toBeTruthy();
    expect(el.querySelector('.md-code-lang')?.textContent).toBe('ts');
    expect(el.querySelector('.md-copy-btn')?.getAttribute('aria-label')).toContain('ts');
    // The code itself is a text node — never parsed as HTML.
    const code = el.querySelector('.md-code pre code')!;
    expect(code.textContent).toBe('const x = 1;');
    expect(code.children.length).toBe(0);
  });

  it('never injects script tags or event-handler attributes (sanitized by construction)', () => {
    const el = render('<script>alert("x")</script>\n**bold** <img src=x onerror=alert(1)>');
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('img')).toBeNull();
    // The raw markup is rendered as inert text.
    expect(el.textContent).toContain('<script>');
  });

  it('renders links with safe attributes only', () => {
    const el = render('[site](https://example.com)');
    const a = el.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('rel')).toContain('noopener');
  });

  it('renders paragraphs with inline formatting', () => {
    const el = render('Hello **world** and `code` here.');
    const p = el.querySelector('p')!;
    expect(p.querySelector('strong')?.textContent).toBe('world');
    expect(p.querySelector('code')?.textContent).toBe('code');
  });

  it('replaces previous content on re-render (streaming updates)', () => {
    const container = document.createElement('div');
    renderMarkdown('# One', container, document);
    renderMarkdown('# Two', container, document);
    expect(container.querySelector('h1')?.textContent).toBe('Two');
    expect(container.children.length).toBe(1);
  });

  it('handles an unclosed fence at end of input without losing content', () => {
    const el = render('```js\nconst y = 2;');
    expect(el.querySelector('.md-code pre code')?.textContent).toBe('const y = 2;');
  });
});
