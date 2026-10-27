// ─── The markdown PANE's renderer: math, mermaid, local images (#380) ───────
// Pure, like markdown-utils.ts: no React, no `window`, no IPC, so the parse
// rules are testable on their own.
//
// The three features share one shape, and it is the security argument. The
// parser emits INERT placeholders whose payload is escaped TEXT — the TeX, the
// diagram source, the image src — and the result goes through the same
// DOMPurify policy as everything else (sanitizeMarkdownHtml). Only after that
// does markdown-hydrate.ts fill them in, reading the payload back as text:
//   - math with KaTeX, `trust: false` (no \href, \includegraphics, \htmlClass…);
//   - mermaid with `securityLevel: 'strict'`, and the SVG shown as an
//     `<img src=data:>`, never inlined, so even a mermaid escape runs no script;
//   - images by main (markdown-image.ts), which returns a data: URL.
// A document can write a placeholder by hand in raw HTML. That gains nothing:
// it is exactly what the markdown syntax already produces.
//
// A separate Marked instance from renderMarkdown's, deliberately: that one
// also renders the changelog, where "$5 and $10" is prose.

import { Marked, type TokenizerAndRendererExtension, type Tokens } from 'marked';
import { sanitizeMarkdownHtml, taskListExtension } from './markdown-utils';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Inline math: pandoc's `tex_math_dollars` rules ─────────────────────────

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

export interface MathMatch {
  raw: string;
  tex: string;
  display: boolean;
}

/** Index of `needle` in `src` from `from`, skipping backslash-escaped chars. */
function indexOfUnescaped(src: string, needle: string, from: number): number {
  for (let i = from; i < src.length; i++) {
    if (src[i] === '\\') { i++; continue; }
    if (src.startsWith(needle, i)) return i;
  }
  return -1;
}

/**
 * Math at the START of `src`, or null. Pandoc's rules, which are what make
 * "costs $5 and $10" stay prose:
 *   - the opening `$` is not followed by whitespace;
 *   - the closing `$` is not preceded by whitespace and not followed by a digit;
 *   - a backslash escapes the next character (so `\$` never closes);
 *   - `$$…$$` is display math.
 * An invalid closer does not end the attempt; the scan moves on to the next
 * `$`, as pandoc does. A paragraph is the scan's natural bound — marked hands
 * an inline tokenizer one block at a time.
 */
export function matchInlineMath(src: string): MathMatch | null {
  if (src[0] !== '$') return null;

  if (src[1] === '$') {
    const end = indexOfUnescaped(src, '$$', 2);
    if (end < 0) return null;
    const tex = src.slice(2, end);
    if (!tex.trim()) return null;
    return { raw: src.slice(0, end + 2), tex, display: true };
  }

  if (isSpace(src[1])) return null;
  for (let i = 1; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c !== '$') continue;
    if (isSpace(src[i - 1]) || isDigit(src[i + 1])) continue;
    return { raw: src.slice(0, i + 1), tex: src.slice(1, i), display: false };
  }
  return null;
}

/** First `$` not escaped by an odd run of backslashes — where math MAY start. */
export function inlineMathStart(src: string): number | undefined {
  for (let i = src.indexOf('$'); i >= 0; i = src.indexOf('$', i + 1)) {
    let slashes = 0;
    for (let j = i - 1; j >= 0 && src[j] === '\\'; j--) slashes++;
    if (slashes % 2 === 0) return i;
  }
  return undefined;
}

/**
 * A `$$` block: a line that opens with `$$` (up to three spaces of indent, so
 * an indented code block is left alone) and a closing `$$` with nothing but
 * whitespace after it on its line. Hand-scanned rather than one regex: a lazy
 * `[\s\S]+?` between two anchors is the backtracking shape a large document
 * turns into a stall.
 */
export function matchBlockMath(src: string): MathMatch | null {
  let start = 0;
  while (start < 3 && src[start] === ' ') start++;
  if (!src.startsWith('$$', start)) return null;

  const end = indexOfUnescaped(src, '$$', start + 2);
  if (end < 0) return null;
  let after = end + 2;
  while (after < src.length && (src[after] === ' ' || src[after] === '\t')) after++;
  if (after < src.length && src[after] !== '\n') return null;
  while (after < src.length && src[after] === '\n') after++;

  const tex = src.slice(start + 2, end);
  if (!tex.trim()) return null;
  return { raw: src.slice(0, after), tex, display: true };
}

type MathToken = Tokens.Generic & { tex: string; display: boolean };

function mathPlaceholder(tex: string, display: boolean, block: boolean): string {
  const tag = block ? 'div' : 'span';
  const cls = display ? 'markdown-pane__math markdown-pane__math--display' : 'markdown-pane__math';
  return `<${tag} class="${cls}" data-math="${display ? 'display' : 'inline'}">${escapeHtml(tex)}</${tag}>`;
}

const inlineMath: TokenizerAndRendererExtension = {
  name: 'wmuxInlineMath',
  level: 'inline',
  start: inlineMathStart,
  tokenizer(src) {
    const m = matchInlineMath(src);
    return m ? { type: 'wmuxInlineMath', raw: m.raw, tex: m.tex, display: m.display } : undefined;
  },
  renderer(token) {
    const { tex, display } = token as MathToken;
    return mathPlaceholder(tex, display, false);
  },
};

const blockMath: TokenizerAndRendererExtension = {
  name: 'wmuxBlockMath',
  level: 'block',
  tokenizer(src) {
    const m = matchBlockMath(src);
    return m ? { type: 'wmuxBlockMath', raw: m.raw, tex: m.tex, display: true } : undefined;
  },
  renderer(token) {
    return mathPlaceholder((token as MathToken).tex, true, true);
  },
};

// ─── Local images ───────────────────────────────────────────────────────────

/**
 * Whether an image src is a LOCAL path that main has to read: relative, a
 * drive path, a `file:` URL, or a UNC/protocol-relative one. The last two are
 * routed here so main can refuse them — left to the page they would be a
 * network fetch, and on Windows `\\host\x` authenticates to that host.
 * Anything with a real scheme (https, data, blob…) keeps the default renderer.
 */
export function isLocalImageSrc(src: string): boolean {
  const s = src.trim();
  if (!s) return false;
  if (/^file:/i.test(s)) return true;
  if (/^[a-z]:/i.test(s)) return true;
  return !/^[a-z][a-z0-9+.-]+:/i.test(s);
}

// ─── The instance ───────────────────────────────────────────────────────────

const doc = new Marked({ gfm: true, breaks: true });
doc.use(taskListExtension);
doc.use({
  extensions: [blockMath, inlineMath],
  renderer: {
    code({ text, lang }: Tokens.Code) {
      const language = (lang ?? '').trim().split(/\s+/)[0].toLowerCase();
      if (language !== 'mermaid') return false;
      return `<div class="markdown-pane__mermaid" data-mermaid="">${escapeHtml(text)}</div>\n`;
    },
    image({ href, title, text, tokens }: Tokens.Image) {
      if (!isLocalImageSrc(href)) return false;
      const alt = tokens ? this.parser.parseInline(tokens, this.parser.textRenderer) : text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
      return `<img class="markdown-pane__image" data-local-src="${escapeHtml(href)}" alt="${escapeHtml(alt)}"${titleAttr}>`;
    },
  },
});

/**
 * The pane's markdown → sanitized HTML with inert placeholders. Same policy as
 * renderMarkdown; the extra markup is a class and a data-* attribute, both of
 * which that policy already admits.
 */
export function renderMarkdownDocument(content: string): string {
  if (!content) return '';
  return sanitizeMarkdownHtml(doc.parse(content) as string);
}
