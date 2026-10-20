// ─── Browser back/forward history across a restart (issue #315) ──────────────
//
// A browser surface used to come back with one entry: the page it was on. Its
// Back and Forward were gone, because a <webview> is a fresh WebContents every
// time it mounts — after a restart, and also after a split-tree restructure
// remounts the pane.
//
// Electron 43's `navigationHistory.restore({ entries, index })` rebuilds the
// stack, but only on a WebContents that has never loaded anything: even
// `about:blank` counts ("Cannot restore history on webContents that have
// previously loaded a page", measured), and a <webview> with no `src` never
// attaches at all. So the pane mounts on a SENTINEL src carrying the history,
// main recognises it in `will-attach-webview`, blanks the src so the guest
// loads nothing of its own, and restores in `did-attach-webview`. The history
// rides inside the src itself rather than over a separate IPC, so there is no
// race between "main was told" and "the webview attached".
//
// What is kept is the URL and title of each entry, and nothing else. Electron
// also offers `pageState`, Chromium's serialized page state — scroll position,
// but also FORM VALUES, which is exactly what must never land in session.json.
//
// Pure, and shared: main sanitizes what it reads off a guest and what it
// decodes from a src; the renderer sanitizes what came back from session.json.

export interface BrowserHistoryEntry {
  url: string;
  title: string;
}

/** A browser surface's back/forward stack, `index` being the page it shows. */
export interface BrowserHistory {
  entries: BrowserHistoryEntry[];
  index: number;
}

/** Entries kept per surface. A restore loads only the active one; the rest are list items. */
export const MAX_HISTORY_ENTRIES = 50;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 200;

/** The src a pane mounts on to ask main for a history restore. */
export const HISTORY_RESTORE_PREFIX = 'about:blank#wmux-history=';

/**
 * Only pages a user navigated to on the web. `file:`, `data:`, `javascript:`,
 * `chrome:` and friends are never restored: an entry is loaded the moment it
 * becomes active, and session.json is a file anyone with the user's account
 * can edit.
 */
function isRestorableUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A history wmux is willing to restore, or null. Unrestorable entries are
 * dropped and the active index follows its entry; if the active entry itself
 * goes, the nearest older one becomes active. A stack longer than the cap keeps
 * the active entry and as much of Back as fits, then Forward — Back is the
 * direction people actually go.
 */
export function sanitizeBrowserHistory(raw: unknown): BrowserHistory | null {
  if (!raw || typeof raw !== 'object') return null;
  const { entries, index } = raw as { entries?: unknown; index?: unknown };
  if (!Array.isArray(entries)) return null;
  const active = typeof index === 'number' && Number.isInteger(index) ? index : entries.length - 1;

  const kept: BrowserHistoryEntry[] = [];
  let keptActive = -1;
  entries.forEach((entry, i) => {
    const url = (entry as { url?: unknown } | null)?.url;
    if (!isRestorableUrl(url)) return;
    const title = (entry as { title?: unknown }).title;
    kept.push({ url, title: typeof title === 'string' ? title.slice(0, MAX_TITLE_LENGTH) : '' });
    if (i <= active) keptActive = kept.length - 1;
  });
  if (kept.length === 0) return null;
  if (keptActive < 0) keptActive = 0;

  const start = Math.max(0, Math.min(keptActive - (MAX_HISTORY_ENTRIES - 1), kept.length - MAX_HISTORY_ENTRIES));
  const windowed = kept.slice(start, start + MAX_HISTORY_ENTRIES);
  return { entries: windowed, index: keptActive - start };
}

/** The URL a history shows. */
export function activeHistoryUrl(history: BrowserHistory): string {
  return history.entries[history.index].url;
}

/** Same stack, same position — used to skip a store write that would change nothing. */
export function sameBrowserHistory(a: BrowserHistory | null | undefined, b: BrowserHistory | null | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.index !== b.index || a.entries.length !== b.entries.length) return false;
  return a.entries.every((e, i) => e.url === b.entries[i].url && e.title === b.entries[i].title);
}

/** The sentinel src that asks main to restore `history` into the guest. */
export function encodeHistoryRestoreSrc(history: BrowserHistory): string {
  return HISTORY_RESTORE_PREFIX + encodeURIComponent(JSON.stringify(history));
}

/** The history a sentinel src carries, sanitized; null for any other src. */
export function decodeHistoryRestoreSrc(src: unknown): BrowserHistory | null {
  if (typeof src !== 'string' || !src.startsWith(HISTORY_RESTORE_PREFIX)) return null;
  try {
    return sanitizeBrowserHistory(JSON.parse(decodeURIComponent(src.slice(HISTORY_RESTORE_PREFIX.length))));
  } catch {
    return null;
  }
}
