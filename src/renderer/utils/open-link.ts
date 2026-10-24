import { openInWmuxBrowser } from './open-in-browser';

/**
 * The one protocol gate for a URL arriving from outside the renderer.
 *
 * Both a terminal's OSC 8/WebLinks link and an app's own browser-open request
 * (`wmux open` -> `link.open`) end up here, so `javascript:`, `file:` and
 * malformed values are refused in one place rather than two.
 */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * `link.open` from main, i.e. a URL an agent or CLI asked wmux to open.
 *
 * It deliberately goes through `openInWmuxBrowser` and NOT `wmux browser open`:
 * this is a human-facing link click, so it follows `openLinksExternally` and
 * lands in the workspace's panel, not the caller's agent-bound browser (#62).
 */
export function openLinkFromBridge(url: unknown): boolean {
  if (!isHttpUrl(url)) return false;
  openInWmuxBrowser(url);
  return true;
}
