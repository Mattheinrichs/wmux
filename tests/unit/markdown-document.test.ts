// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  inlineMathStart,
  isLocalImageSrc,
  matchBlockMath,
  matchInlineMath,
  renderMarkdownDocument,
} from '../../src/renderer/components/Markdown/markdown-document';
import { renderMarkdown } from '../../src/renderer/components/Markdown/markdown-utils';

// Issue #380: math, mermaid and local images in the markdown PANE. The parser
// emits inert placeholders that must survive the shared DOMPurify policy, and
// the changelog renderer (renderMarkdown) must not change at all.

const parse = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host;
};

describe('matchInlineMath — pandoc rules for $', () => {
  it('matches $x$ and $$x$$', () => {
    expect(matchInlineMath('$a^2$ rest')).toEqual({ raw: '$a^2$', tex: 'a^2', display: false });
    expect(matchInlineMath('$$\\int f$$ rest')).toEqual({ raw: '$$\\int f$$', tex: '\\int f', display: true });
  });

  it('refuses an opening $ followed by whitespace', () => {
    expect(matchInlineMath('$ x$')).toBeNull();
  });

  it('does not close on a $ preceded by whitespace or followed by a digit', () => {
    expect(matchInlineMath('$5 and $10')).toBeNull();
    expect(matchInlineMath('$x $')).toBeNull();
    expect(matchInlineMath('$x$5')).toBeNull();
    // An invalid closer is skipped, not fatal: the next valid one closes.
    expect(matchInlineMath('$a $b$')?.tex).toBe('a $b');
  });

  it('never closes on an escaped \\$', () => {
    expect(matchInlineMath('$a\\$b$')?.tex).toBe('a\\$b');
    expect(matchInlineMath('$a\\$')).toBeNull();
  });

  it('start() skips an escaped $', () => {
    expect(inlineMathStart('price \\$5 or $x$')).toBe(13);
    expect(inlineMathStart('\\\\$x$')).toBe(2); // the backslash is itself escaped
    expect(inlineMathStart('no dollars')).toBeUndefined();
  });

  it('matches a $$ block and leaves an indented code block alone', () => {
    expect(matchBlockMath('$$\nE=mc^2\n$$\nnext')).toEqual({ raw: '$$\nE=mc^2\n$$\n', tex: '\nE=mc^2\n', display: true });
    expect(matchBlockMath('    $$x$$')).toBeNull();
    expect(matchBlockMath('$$x$$ trailing')).toBeNull();
  });
});

describe('renderMarkdownDocument — math placeholders', () => {
  it('keeps prices as prose', () => {
    const host = parse(renderMarkdownDocument('It costs $5 and $10, or $20,000 and $30,000.'));
    expect(host.querySelector('[data-math]')).toBeNull();
    expect(host.textContent).toContain('$5 and $10');
  });

  it('keeps an escaped dollar as a literal dollar', () => {
    const host = parse(renderMarkdownDocument('\\$x$ is not math'));
    expect(host.querySelector('[data-math]')).toBeNull();
    expect(host.textContent).toContain('$x$ is not math');
  });

  it('emits an inline placeholder whose payload is the TeX as text', () => {
    const host = parse(renderMarkdownDocument('Area is $\\pi r^2$ here.'));
    const el = host.querySelector('[data-math="inline"]');
    expect(el?.tagName).toBe('SPAN');
    expect(el?.textContent).toBe('\\pi r^2');
  });

  it('emits a display placeholder for a $$ block', () => {
    const host = parse(renderMarkdownDocument('Before\n\n$$\n\\sum_i x_i\n$$\n\nAfter'));
    const el = host.querySelector('[data-math="display"]');
    expect(el?.tagName).toBe('DIV');
    expect(el?.textContent?.trim()).toBe('\\sum_i x_i');
  });

  it('leaves math inside code spans and fenced code untouched', () => {
    const host = parse(renderMarkdownDocument('Use `$x$` here.\n\n```\n$y$\n$$z$$\n```'));
    expect(host.querySelector('[data-math]')).toBeNull();
    expect(host.querySelector('code')?.textContent).toBe('$x$');
    expect(host.querySelector('pre code')?.textContent).toContain('$$z$$');
  });

  it('escapes HTML in the TeX payload — it is text, never markup', () => {
    const html = renderMarkdownDocument('$<img src=x onerror=alert(1)>$');
    const host = parse(html);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[data-math]')?.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(html).not.toMatch(/onerror=alert\(1\)>/);
  });
});

describe('renderMarkdownDocument — mermaid and image placeholders', () => {
  it('turns a mermaid fence into a placeholder holding the source as text', () => {
    const host = parse(renderMarkdownDocument('```mermaid\ngraph TD; A-->B<script>x</script>\n```'));
    const el = host.querySelector('[data-mermaid]');
    expect(el).not.toBeNull();
    expect(el?.textContent).toContain('A-->B<script>x</script>');
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('pre')).toBeNull();
  });

  it('leaves other fences as code blocks', () => {
    const host = parse(renderMarkdownDocument('```ts\nconst a = 1;\n```'));
    expect(host.querySelector('[data-mermaid]')).toBeNull();
    expect(host.querySelector('pre code')?.textContent).toContain('const a = 1;');
  });

  it('routes local srcs to a src-less placeholder and keeps remote ones', () => {
    const host = parse(renderMarkdownDocument(
      '![a](img/a.png) ![b](C:\\pics\\b.png) ![c](file:///C:/c.png) ![d](https://e.org/d.png)',
    ));
    const imgs = [...host.querySelectorAll('img')];
    expect(imgs.map((i) => i.getAttribute('data-local-src'))).toEqual([
      'img/a.png', 'C:\\pics\\b.png', 'file:///C:/c.png', null,
    ]);
    expect(imgs.slice(0, 3).every((i) => !i.hasAttribute('src'))).toBe(true);
    expect(imgs[3].getAttribute('src')).toBe('https://e.org/d.png');
    expect(imgs[0].getAttribute('alt')).toBe('a');
  });

  it('classifies srcs', () => {
    expect(isLocalImageSrc('a.png')).toBe(true);
    expect(isLocalImageSrc('../x.png')).toBe(true);
    expect(isLocalImageSrc('C:/x.png')).toBe(true);
    expect(isLocalImageSrc('//host/x.png')).toBe(true); // so main can refuse it
    expect(isLocalImageSrc('https://x/y.png')).toBe(false);
    expect(isLocalImageSrc('data:image/png;base64,AA')).toBe(false);
  });

  it('still sanitizes everything else with the shared policy', () => {
    const host = parse(renderMarkdownDocument('<script>x</script><p style="color:red" onclick="x()">t</p>'));
    expect(host.querySelector('script')).toBeNull();
    expect(host.querySelector('p')?.hasAttribute('style')).toBe(false);
    expect(host.querySelector('p')?.hasAttribute('onclick')).toBe(false);
  });
});

describe('the changelog renderer is unaffected', () => {
  it('renders dollars, mermaid fences and relative images exactly as before', () => {
    const host = parse(renderMarkdown('Fixed $x$ and $5.\n\n```mermaid\ngraph TD\n```\n\n![a](img/a.png)'));
    expect(host.querySelector('[data-math]')).toBeNull();
    expect(host.querySelector('[data-mermaid]')).toBeNull();
    expect(host.textContent).toContain('$x$');
    expect(host.querySelector('pre code')).not.toBeNull();
    expect(host.querySelector('img')?.getAttribute('src')).toBe('img/a.png');
    expect(host.querySelector('img')?.hasAttribute('data-local-src')).toBe(false);
  });
});
