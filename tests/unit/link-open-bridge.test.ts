import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: {} }));

import { linkOpenJs } from '../../src/main/v2-bridge';

describe('link.open bridge expression', () => {
  it('JSON-escapes quotes and newlines in the URL', () => {
    expect(linkOpenJs('https://example.com/"quoted"')).toBe(
      'window.__wmux_openLink?.("https://example.com/\\"quoted\\"")',
    );
    expect(linkOpenJs('https://example.com/a\nb')).toContain('\\n');
  });

  it('passes an empty string for a non-string url, so the renderer refuses it', () => {
    expect(linkOpenJs(42)).toBe('window.__wmux_openLink?.("")');
    expect(linkOpenJs(undefined)).toBe('window.__wmux_openLink?.("")');
  });
});
