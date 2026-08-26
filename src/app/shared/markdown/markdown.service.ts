/**
 * Dependency-free Markdown renderer for chat messages.
 *
 * Security model: the raw source is HTML-escaped first, so no user content can
 * inject markup; only tags produced by this renderer appear in the output.
 * Links are restricted to http(s) URLs (javascript:/data: links are rendered as
 * plain text). Fenced code blocks keep their language tag and get a copy button
 * wired up via event delegation in the message component.
 */

import { Injectable } from '@angular/core';

const CODE_BLOCK_PLACEHOLDER = '\u0000CB%s\u0000';
const INLINE_CODE_PLACEHOLDER = '\u0000IC%s\u0000';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Only http(s) links are allowed. */
function isSafeUrl(url: string): boolean {
  try {
    const decoded = decodeURIComponent(url);
    return /^https?:\/\//i.test(decoded.trim());
  } catch {
    return false;
  }
}

interface CodeBlock {
  lang: string;
  code: string;
}

/** Inline transforms on already-escaped, non-code text. */
function renderInline(text: string): string {
  // Protect inline code spans first.
  const inlineCodes: string[] = [];
  let out = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    inlineCodes.push(code);
    return INLINE_CODE_PLACEHOLDER.replace('%s', String(inlineCodes.length - 1));
  });

  // Links [text](url) — sanitized.
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) => {
    if (!isSafeUrl(url)) return `${label} (${url})`;
    const href = escapeHtml(url);
    return `<a href="${href}" rel="noopener noreferrer" target="_blank">${label}</a>`;
  });

  // Bold then italic.
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');

  // Restore inline code.
  out = out.replace(new RegExp(INLINE_CODE_PLACEHOLDER.replace('%s', '([0-9]+)'), 'g'), (_m, idx: string) => {
    return `<code class="lb-inline-code">${inlineCodes[Number(idx)]}</code>`;
  });

  return out;
}

function renderCodeBlock(block: CodeBlock): string {
  const lang = block.lang.trim();
  const langAttr = escapeHtml(lang);
  return (
    `<div class="lb-code-block">` +
    (lang ? `<span class="lb-code-lang mono">${langAttr}</span>` : '') +
    `<pre class="lb-code"><code>${block.code}</code></pre>` +
    `<button type="button" class="lb-code-copy" aria-label="Copy code to clipboard">` +
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true">' +
    '<path d="M0 4.75A.75.75 0 0 1 .75 4h9.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 4.75Zm0 6A.75.75 0 0 1 .75 10h9.5a.75.75 0 0 1 0 1.5H.75A.75.75 0 0 1 0 10.75Z"/>' +
    '<path d="M6 0a.75.75 0 0 1 .75.75v9.5a.75.75 0 0 1-1.5 0V.75A.75.75 0 0 1 6 0Zm4 2.75A.75.75 0 0 1 10.75 3.5v9.5a.75.75 0 0 1-1.5 0V3.5A.75.75 0 0 1 10 2.75Z"/>' +
    '</svg>Copy</button></div>'
  );
}

@Injectable({ providedIn: 'root' })
export class MarkdownService {
  /** Render a Markdown source string into safe HTML. */
  render(source: string): string {
    if (!source) return '';
    const normalized = escapeHtml(source.replace(/\r\n/g, '\n'));

    // Extract fenced code blocks (protect from inline processing).
    const blocks: CodeBlock[] = [];
    let text = normalized.replace(/```([^\n]*)\n([\s\S]*?)(?:```|$)/g, (_m, lang: string, code: string) => {
      blocks.push({ lang, code });
      return CODE_BLOCK_PLACEHOLDER.replace('%s', String(blocks.length - 1));
    });

    const lines = text.split('\n');
    const html: string[] = [];
    let paragraph: string[] = [];
    let listType: 'ul' | 'ol' | null = null;

    const flushParagraph = () => {
      if (paragraph.length > 0) {
        html.push(`<p>${paragraph.map(renderInline).join('<br>')}</p>`);
        paragraph = [];
      }
    };
    const flushList = () => {
      if (listType !== null) {
        html.push(`</${listType}>`);
        listType = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, '');

      // Standalone code-block placeholder.
      const blockMatch = line.match(new RegExp(`^${CODE_BLOCK_PLACEHOLDER.replace('%s', '([0-9]+)')}$`));
      if (blockMatch) {
        flushParagraph();
        flushList();
        html.push(renderCodeBlock(blocks[Number(blockMatch[1])]));
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushParagraph();
        flushList();
        const level = Math.min(heading[1].length + 2, 6); // # → h3 in chat context
        html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        continue;
      }

      const ulItem = line.match(/^[-*]\s+(.*)$/);
      if (ulItem) {
        flushParagraph();
        if (listType !== 'ul') {
          flushList();
          html.push('<ul>');
          listType = 'ul';
        }
        html.push(`<li>${renderInline(ulItem[1])}</li>`);
        continue;
      }

      const olItem = line.match(/^\d+[.)]\s+(.*)$/);
      if (olItem) {
        flushParagraph();
        if (listType !== 'ol') {
          flushList();
          html.push('<ol>');
          listType = 'ol';
        }
        html.push(`<li>${renderInline(olItem[1])}</li>`);
        continue;
      }

      if (line.trim().length === 0) {
        flushParagraph();
        flushList();
        continue;
      }

      // Inline code placeholder may share a line with text.
      paragraph.push(line);
    }
    flushParagraph();
    flushList();

    return html.join('\n');
  }
}
