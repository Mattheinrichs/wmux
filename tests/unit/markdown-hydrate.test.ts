// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderMarkdownDocument } from '../../src/renderer/components/Markdown/markdown-document';
import {
  createMermaidCache,
  hydrateImages,
  hydrateMath,
  showMermaid,
  svgForImage,
} from '../../src/renderer/components/Markdown/markdown-hydrate';

// Issue #380: the pipeline end to end in jsdom — markdown → sanitized
// placeholders → filled DOM. Mermaid itself needs real layout (getBBox), so
// its render is injected; KaTeX runs for real.

const mount = (markdown: string) => {
  const host = document.createElement('div');
  host.innerHTML = renderMarkdownDocument(markdown);
  return host;
};
const fresh = () => false;

describe('hydrateMath (real KaTeX)', () => {
  it('typesets inline and display math', async () => {
    const host = mount('Inline $a^2$ and\n\n$$\n\\frac{1}{2}\n$$');
    await hydrateMath(host, fresh);
    expect(host.querySelectorAll('.katex').length).toBe(2);
    expect(host.querySelector('[data-math="display"] .katex-display')).not.toBeNull();
  });

  it('refuses \\href and friends — trust is off', async () => {
    const host = mount('$\\href{javascript:alert(1)}{click}$ $\\url{https://e.org}$ $\\htmlClass{x}{y}$');
    await hydrateMath(host, fresh);
    expect(host.querySelector('a, [href], .x')).toBeNull();
    // The source survives only as the inert MathML annotation (text).
    for (const el of host.querySelectorAll('*')) {
      for (const attr of el.attributes) expect(attr.value).not.toContain('javascript:');
    }
  });

  it('shows a typo inline instead of throwing', async () => {
    const host = mount('Bad $\\frac{1}{$ here');
    await expect(hydrateMath(host, fresh)).resolves.toBeUndefined();
    expect(host.textContent).toContain('Bad');
    expect(host.querySelector('[data-math]')?.textContent).toContain('\\frac');
  });

  it('is idempotent: a second pass renders from the original source', async () => {
    const host = mount('$x+1$');
    await hydrateMath(host, fresh);
    const first = host.innerHTML;
    await hydrateMath(host, fresh);
    expect(host.innerHTML).toBe(first);
  });

  it('writes nothing into a stale document', async () => {
    const host = mount('$x$');
    await hydrateMath(host, () => true);
    expect(host.querySelector('.katex')).toBeNull();
  });
});

describe('hydrateImages', () => {
  it('fills a local image from main\'s data URL, with the document path as base', async () => {
    const host = mount('![shot](img/a.png)');
    const read = vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,AAAA' });
    await hydrateImages(host, 'C:\\docs\\README.md', read, fresh);
    expect(read).toHaveBeenCalledWith('C:\\docs\\README.md', 'img/a.png');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('never sets a src that is not an image data URL', async () => {
    const host = mount('![x](a.png)');
    await hydrateImages(host, null, async () => ({ dataUrl: 'javascript:alert(1)' }), fresh);
    const img = host.querySelector('img')!;
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.classList.contains('markdown-pane__image--failed')).toBe(true);
  });

  it('marks a refused image with the reason', async () => {
    const host = mount('![x](\\\\evil\\s\\x.png)');
    await hydrateImages(host, null, async () => ({ error: 'Network images are refused' }), fresh);
    expect(host.querySelector('img')?.title).toContain('Network images are refused');
  });

  it('does not touch remote images', async () => {
    const host = mount('![x](https://e.org/x.png)');
    const read = vi.fn();
    await hydrateImages(host, null, read, fresh);
    expect(read).not.toHaveBeenCalled();
  });
});

describe('mermaid', () => {
  it('caches by (theme, source): an unchanged diagram is not re-rendered', async () => {
    const render = vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"></svg>');
    const get = createMermaidCache(render);
    await get('graph TD; A-->B', 'dark');
    await get('graph TD; A-->B', 'dark');
    expect(render).toHaveBeenCalledTimes(1);
    await get('graph TD; A-->B', 'light');
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('evicts the least recently used entry', async () => {
    const render = vi.fn(async () => '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const get = createMermaidCache(render, 2);
    await get('a', 'dark');
    await get('b', 'dark');
    await get('a', 'dark');
    await get('c', 'dark'); // evicts b
    await get('a', 'dark');
    expect(render).toHaveBeenCalledTimes(3);
    await get('b', 'dark');
    expect(render).toHaveBeenCalledTimes(4);
  });

  it('turns a failed render into an error result, not a rejection', async () => {
    const get = createMermaidCache(async () => { throw new Error('Parse error on line 1'); });
    await expect(get('nope', 'dark')).resolves.toEqual({ error: 'Parse error on line 1' });
  });

  it('sizes the SVG from its viewBox for <img> use', () => {
    const out = svgForImage('<svg xmlns="http://www.w3.org/2000/svg" width="100%" style="max-width: 120px;" viewBox="0 0 120.5 80"></svg>');
    expect(out).toContain('width="121"');
    expect(out).toContain('height="80"');
    expect(out).not.toContain('max-width');
  });

  it('shows the diagram as an <img>, never inlined SVG', () => {
    const host = mount('```mermaid\ngraph TD\n```');
    const el = host.querySelector<HTMLElement>('[data-mermaid]')!;
    showMermaid(el, 'graph TD', { dataUrl: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E' });
    expect(el.querySelector('svg')).toBeNull();
    expect(el.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('keeps the source visible under an error', () => {
    const host = mount('```mermaid\ngraph <b>TD\n```');
    const el = host.querySelector<HTMLElement>('[data-mermaid]')!;
    showMermaid(el, 'graph <b>TD', { error: 'Syntax error' });
    expect(el.querySelector('b')).toBeNull();
    expect(el.textContent).toContain('Syntax error');
    expect(el.querySelector('pre')?.textContent).toBe('graph <b>TD');
  });
});
