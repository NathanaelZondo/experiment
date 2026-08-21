/**
 * Minimal Markdown → DOM renderer for chat messages.
 *
 * Sanitized by construction: every text node is created with `textContent`
 * and only a fixed set of element types is ever produced — no innerHTML, no
 * user-controlled attributes (links are restricted to http/https), so there
 * is no injection surface. Supports headings, fenced code blocks, inline
 * code, bold, italic, links, blockquotes and lists.
 */

interface InlineToken {
  type: 'text' | 'bold' | 'italic' | 'code' | 'link';
  value: string;
  href?: string;
}

const FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^\s*[-*+]\s+/;
const ORDERED_RE = /^\s*\d+[.)]\s+/;

/** Parses inline markdown into a flat token list (bold before italic). */
export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let rest = text;

  for (;;) {
    // Code spans first so their contents are never further formatted.
    const codeMatch = rest.match(/`([^`\n]+)`/);
    const boldMatch = rest.match(/\*\*([^\s](?:[^*]*[^\s])?)\*\*/);
    const italicMatch = rest.match(/\*([^\s*][^*]*[^\s*]|[^\s*])\*/);
    const linkMatch = rest.match(/\[([^\]]+)\]\(([^)\s]+)\)/);

    let best: { index: number; length: number; token: InlineToken } | null = null;
    for (const candidate of [codeMatch, boldMatch, italicMatch, linkMatch]) {
      if (candidate === null) {
        continue;
      }
      const token: InlineToken | null =
        candidate === codeMatch
          ? { type: 'code', value: candidate[1] }
          : candidate === boldMatch
            ? { type: 'bold', value: candidate[1] }
            : candidate === italicMatch
              ? { type: 'italic', value: candidate[1] }
              : safeHref(candidate[2]) !== null
                ? { type: 'link', value: candidate[1], href: safeHref(candidate[2]) ?? undefined }
                : null;
      if (token === null) {
        continue; // A link with a disallowed URL is rendered as plain text.
      }
      const index = rest.indexOf(candidate[0]);
      if (best === null || index < best.index) {
        best = { index, length: candidate[0].length, token };
      }
    }

    if (best === null) {
      if (rest !== '') {
        tokens.push({ type: 'text', value: rest });
      }
      break;
    }
    if (best.index > 0) {
      tokens.push({ type: 'text', value: rest.slice(0, best.index) });
    }
    tokens.push(best.token);
    rest = rest.slice(best.index + best.length);
  }

  return tokens;
}

/** Allows only http(s) URLs — everything else is rendered as plain text. */
export function safeHref(url: string): string | null {
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  // Relative links are not meaningful in chat — reject them too.
  return null;
}

/** Builds DOM nodes for inline tokens (recursive for bold/italic nesting). */
export function buildInlineNodes(text: string, documentRef: Document): Node[] {
  const nodes: Node[] = [];
  for (const token of parseInline(text)) {
    if (token.type === 'text') {
      nodes.push(documentRef.createTextNode(token.value));
    } else if (token.type === 'code') {
      const code = documentRef.createElement('code');
      code.textContent = token.value;
      nodes.push(code);
    } else if (token.type === 'bold' || token.type === 'italic') {
      const el = documentRef.createElement(token.type === 'bold' ? 'strong' : 'em');
      for (const child of buildInlineNodes(token.value, documentRef)) {
        el.appendChild(child);
      }
      nodes.push(el);
    } else if (token.type === 'link') {
      const a = documentRef.createElement('a');
      a.href = token.href ?? '#';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      for (const child of buildInlineNodes(token.value, documentRef)) {
        a.appendChild(child);
      }
      nodes.push(a);
    }
  }
  return nodes;
}

/**
 * Renders markdown text into `container`, replacing its previous content.
 * Fenced code blocks are wrapped in `.md-code` with a language label and a
 * copy button wired up directly (no framework involvement).
 */
export function renderMarkdown(markdown: string, container: HTMLElement, documentRef: Document): void {
  // Replace any previously rendered content (also detaches old copy-button listeners).
  container.textContent = '';

  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fenceMatch = line.match(FENCE_RE);
    if (fenceMatch !== null) {
      const marker = fenceMatch[2];
      const language = fenceMatch[3] || 'text';
      i += 1;
      const body: string[] = [];
      while (i < lines.length && !lines[i].trimStart().startsWith(marker)) {
        body.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) {
        i += 1; // Consume the closing fence.
      }
      container.appendChild(buildCodeBlock(body.join('\n'), language, documentRef));
      continue;
    }

    // Blank line — paragraph separator.
    if (line.trim() === '') {
      i += 1;
      continue;
    }

    // Heading.
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch !== null) {
      const level = Math.min(headingMatch[1].length, 6);
      const h = documentRef.createElement(`h${level}`);
      for (const node of buildInlineNodes(headingMatch[2], documentRef)) {
        h.appendChild(node);
      }
      container.appendChild(h);
      i += 1;
      continue;
    }

    // Blockquote.
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) {
        quote.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      const blockquote = documentRef.createElement('blockquote');
      for (const node of buildInlineNodes(quote.join('\n'), documentRef)) {
        blockquote.appendChild(node);
      }
      container.appendChild(blockquote);
      continue;
    }

    // Unordered list.
    if (BULLET_RE.test(line)) {
      const ul = documentRef.createElement('ul');
      while (i < lines.length && BULLET_RE.test(lines[i])) {
        const li = documentRef.createElement('li');
        for (const node of buildInlineNodes(lines[i].replace(BULLET_RE, ''), documentRef)) {
          li.appendChild(node);
        }
        ul.appendChild(li);
        i += 1;
      }
      container.appendChild(ul);
      continue;
    }

    // Ordered list.
    if (ORDERED_RE.test(line)) {
      const ol = documentRef.createElement('ol');
      while (i < lines.length && ORDERED_RE.test(lines[i])) {
        const li = documentRef.createElement('li');
        for (const node of buildInlineNodes(lines[i].replace(ORDERED_RE, ''), documentRef)) {
          li.appendChild(node);
        }
        ol.appendChild(li);
        i += 1;
      }
      container.appendChild(ol);
      continue;
    }

    // Paragraph: gather consecutive plain lines.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !FENCE_RE.test(lines[i]) && !HEADING_RE.test(lines[i]) && !lines[i].startsWith('>') && !BULLET_RE.test(lines[i]) && !ORDERED_RE.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    const p = documentRef.createElement('p');
    for (const node of buildInlineNodes(paragraph.join('\n'), documentRef)) {
      p.appendChild(node);
    }
    container.appendChild(p);
  }
}

function buildCodeBlock(code: string, language: string, documentRef: Document): HTMLElement {
  const wrap = documentRef.createElement('div');
  wrap.className = 'md-code';

  const header = documentRef.createElement('div');
  header.className = 'md-code-header';

  const label = documentRef.createElement('span');
  label.className = 'md-code-lang';
  label.textContent = language; // textContent — never parsed as HTML.
  header.appendChild(label);

  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = 'md-copy-btn';
  button.setAttribute('aria-label', `Copy ${language} code`);
  button.textContent = 'Copy';
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;
  button.addEventListener('click', () => {
    void copyTextToClipboard(code).then((ok) => {
      if (!ok) {
        return;
      }
      button.textContent = 'Copied ✓';
      if (copiedTimer !== null) {
        clearTimeout(copiedTimer);
      }
      copiedTimer = setTimeout(() => {
        button.textContent = 'Copy';
      }, 1500);
    });
  });
  header.appendChild(button);

  const pre = documentRef.createElement('pre');
  const codeEl = documentRef.createElement('code');
  codeEl.textContent = code; // textContent — sanitized by construction.
  pre.appendChild(codeEl);

  wrap.appendChild(header);
  wrap.appendChild(pre);
  return wrap;
}

/** Copies text to the clipboard with a legacy fallback for non-secure contexts. */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
