import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('electron', () => ({}));
import {
  HISTORY_RESTORE_PREFIX,
  MAX_HISTORY_ENTRIES,
  decodeHistoryRestoreSrc,
  encodeHistoryRestoreSrc,
  sameBrowserHistory,
  sanitizeBrowserHistory,
} from '../../src/shared/browser-history';
import {
  __resetHistoryRestore,
  applyHistoryRestore,
  claimHistoryRestore,
  forgetHistoryRestore,
  parkHistoryRestore,
  readGuestHistory,
  type HistoryGuest,
} from '../../src/main/browser-history-restore';
import { historyRestoreSrc } from '../../src/renderer/components/Browser/BrowserPane';

/**
 * Issue #315 — Back/Forward across a restart. The mechanism (sentinel src →
 * will-attach blanks it → web-contents-created claims → did-attach restores)
 * was measured against a real Electron 43 with three webviews attaching at
 * once; these pin the decisions around it.
 */

const e = (path: string, title = path) => ({ url: `https://example.com/${path}`, title });

describe('sanitizeBrowserHistory', () => {
  it('keeps url and title only — never pageState, which carries form values', () => {
    const clean = sanitizeBrowserHistory({
      entries: [{ ...e('a'), pageState: 'c2VjcmV0' }, e('b')],
      index: 1,
    });
    expect(clean).toEqual({ entries: [e('a'), e('b')], index: 1 });
  });

  it('drops pages that are not http(s), and the active index follows its entry', () => {
    const clean = sanitizeBrowserHistory({
      entries: [e('a'), { url: 'file:///C:/secret.txt', title: 'x' }, { url: 'javascript:alert(1)', title: '' }, e('b'), e('c')],
      index: 3,
    });
    expect(clean).toEqual({ entries: [e('a'), e('b'), e('c')], index: 1 });
  });

  it('falls back to the nearest older entry when the active one is dropped', () => {
    const clean = sanitizeBrowserHistory({ entries: [e('a'), { url: 'chrome://gpu', title: '' }, e('b')], index: 1 });
    expect(clean?.index).toBe(0);
    const first = sanitizeBrowserHistory({ entries: [{ url: 'data:,x', title: '' }, e('a')], index: 0 });
    expect(first).toEqual({ entries: [e('a')], index: 0 });
  });

  it('keeps Back over Forward when the stack is over the cap', () => {
    const entries = Array.from({ length: 100 }, (_, i) => e(String(i)));
    const atEnd = sanitizeBrowserHistory({ entries, index: 99 })!;
    expect(atEnd.entries).toHaveLength(MAX_HISTORY_ENTRIES);
    expect(atEnd.entries[atEnd.index].url).toBe(e('99').url);
    expect(atEnd.entries[0].url).toBe(e('50').url);
    const early = sanitizeBrowserHistory({ entries, index: 10 })!;
    expect(early.entries[0].url).toBe(e('0').url);
    expect(early.entries[early.index].url).toBe(e('10').url);
  });

  it('answers null for anything that is not a history', () => {
    expect(sanitizeBrowserHistory(null)).toBeNull();
    expect(sanitizeBrowserHistory({ entries: 'nope' })).toBeNull();
    expect(sanitizeBrowserHistory({ entries: [{ url: 'about:blank' }], index: 0 })).toBeNull();
  });

  it('caps titles', () => {
    const clean = sanitizeBrowserHistory({ entries: [{ url: e('a').url, title: 'x'.repeat(999) }], index: 0 });
    expect(clean?.entries[0].title.length).toBe(200);
  });
});

describe('the restore sentinel', () => {
  it('round-trips a history and refuses any other src', () => {
    const h = { entries: [e('a'), e('b?q=1&r=2#frag')], index: 0 };
    expect(decodeHistoryRestoreSrc(encodeHistoryRestoreSrc(h))).toEqual(h);
    expect(decodeHistoryRestoreSrc('https://example.com/')).toBeNull();
    expect(decodeHistoryRestoreSrc(`${HISTORY_RESTORE_PREFIX}%7Bnot-json`)).toBeNull();
  });

  it('is only used for a web pane with a real stack whose page is the one being opened', () => {
    const h = { entries: [e('a'), e('b')], index: 1 };
    expect(historyRestoreSrc('web', e('b').url, h)).toBe(encodeHistoryRestoreSrc(h));
    expect(historyRestoreSrc('agent', e('b').url, h)).toBeNull();
    expect(historyRestoreSrc('web', e('a').url, h)).toBeNull(); // stale stack: the URL rules win
    expect(historyRestoreSrc('web', e('a').url, { entries: [e('a')], index: 0 })).toBeNull();
    expect(historyRestoreSrc('web', e('b').url, undefined)).toBeNull();
  });

  it('compares stacks by entries and position', () => {
    const h = { entries: [e('a'), e('b')], index: 1 };
    expect(sameBrowserHistory(h, { entries: [e('a'), e('b')], index: 1 })).toBe(true);
    expect(sameBrowserHistory(h, { ...h, index: 0 })).toBe(false);
    expect(sameBrowserHistory(h, { entries: [e('a'), e('b', 'retitled')], index: 1 })).toBe(false);
    expect(sameBrowserHistory(h, null)).toBe(false);
  });
});

describe('main: pairing a restore with its own guest', () => {
  beforeEach(() => __resetHistoryRestore());

  const guest = (id: number, entries: Array<{ url: string; title: string }> = [], index = 0) => {
    const restore = vi.fn(() => Promise.resolve());
    const g: HistoryGuest = {
      id,
      navigationHistory: { getAllEntries: () => entries, getActiveIndex: () => index, restore },
    };
    return { g, restore };
  };

  it('blanks the sentinel src and restores into the guest created right after it', () => {
    const hA = { entries: [e('a0'), e('a1')], index: 1 };
    const hB = { entries: [e('b0'), e('b1'), e('b2')], index: 0 };
    const a = guest(2);
    const b = guest(3);
    // Measured order: will-attach A, created A, will-attach B, created B; the
    // did-attach events are async and may come in either order.
    const pA: Record<string, unknown> = { src: encodeHistoryRestoreSrc(hA) };
    parkHistoryRestore(pA);
    claimHistoryRestore(2);
    const pB: Record<string, unknown> = { src: encodeHistoryRestoreSrc(hB) };
    parkHistoryRestore(pB);
    claimHistoryRestore(3);
    expect(pA.src).toBe('');
    expect(pB.src).toBe('');
    expect(applyHistoryRestore(b.g)).toBe(true);
    expect(applyHistoryRestore(a.g)).toBe(true);
    expect(a.restore).toHaveBeenCalledWith({ entries: hA.entries, index: 1 });
    expect(b.restore).toHaveBeenCalledWith({ entries: hB.entries, index: 0 });
    expect(applyHistoryRestore(a.g)).toBe(false); // once
  });

  it('leaves an ordinary webview alone, even right after a park nobody claimed', () => {
    parkHistoryRestore({ src: encodeHistoryRestoreSrc({ entries: [e('a'), e('b')], index: 0 }) });
    const plain: Record<string, unknown> = { src: 'https://example.com/' };
    parkHistoryRestore(plain); // a fresh attach overwrites the stale slot
    claimHistoryRestore(7);
    expect(plain.src).toBe('https://example.com/');
    expect(applyHistoryRestore(guest(7).g)).toBe(false);
  });

  it('forgets a claim whose guest died before attaching', () => {
    parkHistoryRestore({ src: encodeHistoryRestoreSrc({ entries: [e('a'), e('b')], index: 0 }) });
    claimHistoryRestore(9);
    forgetHistoryRestore(9);
    expect(applyHistoryRestore(guest(9).g)).toBe(false);
  });

  it('reads a guest\'s stack in the persisted shape', () => {
    const { g } = guest(1, [{ ...e('a'), pageState: 'x' } as never, e('b')], 0);
    expect(readGuestHistory(g)).toEqual({ entries: [e('a'), e('b')], index: 0 });
  });
});
