import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openInWmuxBrowser } = vi.hoisted(() => ({ openInWmuxBrowser: vi.fn() }));
vi.mock('../../src/renderer/utils/open-in-browser', () => ({ openInWmuxBrowser }));

import { isHttpUrl, openLinkFromBridge } from '../../src/renderer/utils/open-link';

describe('openLinkFromBridge', () => {
  beforeEach(() => openInWmuxBrowser.mockReset());

  it('dispatches an http(s) URL and reports success', () => {
    expect(openLinkFromBridge('https://example.com/a?b=c')).toBe(true);
    expect(openInWmuxBrowser).toHaveBeenCalledWith('https://example.com/a?b=c');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'not a url', '', 42, null])(
    'refuses %p without dispatching',
    value => {
      expect(openLinkFromBridge(value)).toBe(false);
      expect(openInWmuxBrowser).not.toHaveBeenCalled();
    },
  );
});

describe('isHttpUrl', () => {
  it('accepts only http and https', () => {
    expect(isHttpUrl('http://localhost:3000')).toBe(true);
    expect(isHttpUrl('https://example.com')).toBe(true);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('//example.com')).toBe(false);
  });
});
