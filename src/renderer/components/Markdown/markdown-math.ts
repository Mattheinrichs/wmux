// ─── KaTeX, loaded only for a document with math (#380) ─────────────────────
// Imported dynamically by markdown-hydrate.ts, so KaTeX, its stylesheet and
// its fonts land in a lazy chunk the desktop entry does not carry. Vite emits
// the CSS beside that chunk and loads it with it.
//
// KaTeX writes its own markup into the placeholder, inline `style`s included,
// AFTER DOMPurify ran — the sanitize policy (FORBID_ATTR: ['style']) is not
// relaxed for it. What makes that safe is KaTeX's own contract: with
// `trust: false` it refuses every command that emits a URL, a class, an id or
// raw HTML (\href, \url, \includegraphics, \htmlClass, \htmlData…), and it
// escapes the text it is given.

import katex from 'katex';
import 'katex/dist/katex.min.css';

export function renderMath(el: HTMLElement, tex: string, display: boolean): void {
  try {
    katex.render(tex, el, {
      displayMode: display,
      // A typo renders as red source with the message in a tooltip, in place,
      // rather than blanking the paragraph around it.
      throwOnError: false,
      trust: false,
      strict: 'ignore',
      // Bounds on what one expression may cost: \rule{1000em}, or a macro that
      // expands forever.
      maxSize: 100,
      maxExpand: 1000,
    });
    el.classList.remove('markdown-pane__math--error');
  } catch (err: unknown) {
    // throwOnError:false covers ParseError only; anything else lands here.
    el.textContent = tex;
    el.title = (err as Error)?.message || String(err);
    el.classList.add('markdown-pane__math--error');
  }
}
