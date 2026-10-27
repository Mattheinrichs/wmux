// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { isNetworkPathRef, renderMarkdown } from '../../src/renderer/components/Markdown/markdown-utils';

/**
 * Raw HTML in markdown (any pane, the changelog included) could carry
 * `<img src="//host/share/x.png">`. From the packaged `file://` origin that is
 * a UNC fetch, and Windows answers the SMB server with the user's NTLM hash.
 */
describe('isNetworkPathRef', () => {
  it.each([
    '//evil.example/share/x.png',
    '\\\\evil\\share\\x.png',
    '/\\evil/share/x.png',
    '  //evil/x.png',
    'file://evil/share/x.png',
    'FILE://EVIL/x.png',
    'file:////evil/share/x.png',
    'file:\\\\evil\\x.png',
  ])('refuses %s', (v) => expect(isNetworkPathRef(v)).toBe(true));

  it.each([
    'https://example.com/x.png',
    'data:image/png;base64,AAAA',
    'figures/plot.png',
    '/abs/x.png',
    'file:///C:/Users/me/x.png',
    'file:/C:/x.png',
    'file://localhost/C:/x.png',
    'file://c:/x.png',
  ])('allows %s', (v) => expect(isNetworkPathRef(v)).toBe(false));
});

describe('sanitize policy drops network-path fetches', () => {
  it('strips a UNC img src from raw HTML', () => {
    const html = renderMarkdown('<img src="//evil/share/x.png" alt="a">');
    expect(html).toContain('<img');
    expect(html).not.toContain('evil');
  });

  it('strips a srcset whose any candidate is a network path', () => {
    const html = renderMarkdown('<img srcset="https://ok.example/a.png 1x, \\\\evil\\s\\b.png 2x">');
    expect(html).not.toContain('evil');
  });

  it('keeps ordinary image sources and links', () => {
    const html = renderMarkdown('<img src="https://ok.example/a.png"> [x](//example.com/page)');
    expect(html).toContain('https://ok.example/a.png');
    // A link only fetches on click, which goes through openExternal — out of scope.
    expect(html).toContain('//example.com/page');
  });
});
