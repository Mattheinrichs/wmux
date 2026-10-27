// ─── Mermaid, loaded only for a document with a diagram (#380) ──────────────
// Imported dynamically by markdown-hydrate.ts (which also caches by source);
// mermaid is the largest dependency wmux has and must never reach the desktop
// entry chunk or the phone console.
//
// `securityLevel: 'strict'` makes mermaid encode HTML in labels and disables
// click handlers. The SVG is then shown as an `<img src=data:>`, not inlined:
// an SVG in an image context runs no script and loads nothing, so a mermaid
// sanitizer bug still cannot reach the renderer that holds `window.wmux`, and
// its `<style>` cannot restyle the app around the pane.

import mermaid from 'mermaid';
import type { UiThemeName } from './markdown-hydrate';

let configuredTheme: UiThemeName | null = null;
let sequence = 0;
// mermaid.initialize() is global, so renders are serialized: a dark render must
// not run under a light configuration because two panes asked at once.
let queue: Promise<unknown> = Promise.resolve();

async function renderNow(source: string, theme: UiThemeName): Promise<string> {
  if (configuredTheme !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      // SVG <text> labels rather than <foreignObject> HTML: they render the
      // same inside an <img>, with nothing HTML-shaped left in the output.
      htmlLabels: false,
      // Without this a syntax error is drawn as a "bomb" SVG appended to
      // <body>, outside the pane; the error is shown in place instead.
      suppressErrorRendering: true,
    });
    configuredTheme = theme;
  }
  sequence += 1;
  const { svg } = await mermaid.render(`wmux-mermaid-${sequence}`, source);
  return svg;
}

export function renderMermaidSvg(source: string, theme: UiThemeName): Promise<string> {
  const run = queue.then(() => renderNow(source, theme));
  queue = run.catch(() => undefined);
  return run;
}
