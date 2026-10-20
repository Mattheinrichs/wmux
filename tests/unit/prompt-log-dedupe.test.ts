import { describe, it, expect, beforeEach } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { __resetPromptLog, forgetSurface, recordAgentPrompt } from '../../src/renderer/utils/prompt-log';
import { useStore } from '../../src/renderer/store';

/**
 * Issue #310 — two producers, one prompt.
 *
 * On a local OpenCode server both halves report the same submission: the server
 * plugin's `session.prompt` admission hook (#304) and the TUI half's
 * `session.inbox.enqueued` (#312). One prompt must enter the log once — the
 * dedupe window in `recordAgentPrompt` is the only thing preventing two jump
 * marks on one line, so it is pinned here rather than trusted.
 *
 * The terminal stand-in models what `prompt-marks` touches on the commit path:
 * a marker knows its line, a decoration registers, and the anchor's scroll
 * calls exist.
 */
interface FakeMarker { line: number; dispose(): void; isDisposed: boolean }

function fakeTerminal(rows: string[]): Terminal {
  const markers: FakeMarker[] = [];
  const state = { baseY: 0, cursorY: rows.length - 1, cursorX: rows[rows.length - 1]?.length ?? 0 };
  const term = {
    rows: 24,
    cols: 80,
    options: { theme: { background: '#101010' } },
    buffer: {
      active: {
        type: 'normal',
        ...state,
        get baseY() { return state.baseY; },
        get cursorY() { return state.cursorY; },
        get cursorX() { return state.cursorX; },
        getLine: (y: number) => (rows[y] === undefined
          ? undefined
          : { translateToString: () => rows[y] }),
      },
    },
    registerMarker(offset: number): FakeMarker {
      const marker: FakeMarker = {
        line: state.baseY + state.cursorY + offset,
        isDisposed: false,
        dispose() { this.isDisposed = true; },
      };
      markers.push(marker);
      return marker;
    },
    registerDecoration() { return { onRender() {}, dispose() {} }; },
    scrollToLine() {},
    scrollToBottom() {},
  };
  return term as unknown as Terminal;
}

describe('two producers, one prompt (#310)', () => {
  const SURFACE = 'surf-dedupe';
  const ROWS = ['PS C:\\repo> fix the flaky test'];

  beforeEach(() => {
    __resetPromptLog();
    forgetSurface(SURFACE);
    useStore.getState().clearPromptsForSurface(SURFACE);
  });

  const prompts = () => useStore.getState().prompts[SURFACE] ?? [];

  it('keeps ONE entry when both halves report the same text inside the window', () => {
    const term = fakeTerminal(ROWS);
    recordAgentPrompt(term, SURFACE, 'fix the flaky test', 1_000_000);
    recordAgentPrompt(term, SURFACE, 'fix the flaky test', 1_000_200);
    expect(prompts()).toHaveLength(1);
  });

  it('keeps TWO when the same text is genuinely typed again later', () => {
    const term = fakeTerminal(ROWS);
    recordAgentPrompt(term, SURFACE, 'fix the flaky test', 1_000_000);
    recordAgentPrompt(term, SURFACE, 'fix the flaky test', 1_003_000);
    expect(prompts()).toHaveLength(2);
  });
});
