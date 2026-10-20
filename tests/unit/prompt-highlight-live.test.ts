// @vitest-environment jsdom
//
// The submit-time mark is inside the agent's live input region. Until the echo
// has been painted above it, the band must stay a ruler tick — not a blue slab
// across the composer (and, in OpenCode, across the session sidebar beside it).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import { useStore } from '../../src/renderer/store';
import { __resetPromptLog, forgetSurface, recordAgentPrompt } from '../../src/renderer/utils/prompt-log';

interface FakeDecoration {
  options: Record<string, unknown>;
  disposed: boolean;
  onRender(cb: (el: HTMLElement) => void): void;
  dispose(): void;
}

function fakeTerminal(rows: string[]) {
  const decorations: FakeDecoration[] = [];
  const state = { baseY: 0, cursorY: rows.length - 1 };
  const term = {
    rows: 24,
    cols: 80,
    options: { theme: { background: '#1e1e1e' } },
    buffer: {
      active: {
        get baseY() { return state.baseY; },
        get cursorY() { return state.cursorY; },
        get cursorX() { return 0; },
        getLine: (y: number) => (rows[y] === undefined
          ? undefined
          : { translateToString: () => rows[y] }),
      },
    },
    registerMarker(offset: number) {
      return {
        line: state.baseY + state.cursorY + offset,
        isDisposed: false,
        dispose() { this.isDisposed = true; },
      };
    },
    registerDecoration(options: Record<string, unknown>): FakeDecoration {
      const decoration: FakeDecoration = {
        options,
        disposed: false,
        onRender() {},
        dispose() { this.disposed = true; },
      };
      decorations.push(decoration);
      return decoration;
    },
    scrollToLine() {},
  };
  return { term: term as unknown as Terminal, decorations, rows };
}

const SURFACE = 'surf-live';
const PROMPT = 'fix the flaky pty-manager test';

function latest(decorations: FakeDecoration[]): FakeDecoration | undefined {
  return decorations[decorations.length - 1];
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetPromptLog();
  forgetSurface(SURFACE);
  useStore.setState({ prompts: {} });
  useStore.setState((state) => ({
    promptPrefs: {
      ...state.promptPrefs,
      enabled: true,
      highlight: true,
      ruler: true,
      anchor: false,
    },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  __resetPromptLog();
  forgetSurface(SURFACE);
});

describe('an agent prompt submitted from the live composer', () => {
  it('holds the band until the echo appears above, then moves it there', () => {
    const rows = [
      ' session one    │  ready',
      ' session two    │  ',
      ' working…',
      `> ${PROMPT}`,
    ];
    const { term, decorations } = fakeTerminal(rows);
    recordAgentPrompt(term, SURFACE, PROMPT, 1_000);

    // The composer still holds the text, so the block is found — but it is the
    // live input row, so only the scrollbar tick is drawn.
    expect(latest(decorations)?.options.backgroundColor).toBeUndefined();
    expect(latest(decorations)?.options.overviewRulerOptions).toBeTruthy();

    // The TUI now paints the echoed prompt above the composer and clears it.
    rows[0] = ' session one    │  fix the flaky pty-manager';
    rows[1] = ' session two    │  test';
    rows[3] = '> ';
    vi.advanceTimersByTime(200);

    const echo = latest(decorations)!;
    expect(echo.options.backgroundColor).toBeTruthy();
    expect(echo.options.height).toBe(2);
    expect(echo.options.x).toBe(rows[0].indexOf('fix') - 1);
    expect(echo.options.width).toBeLessThan(80);
    expect(useStore.getState().prompts[SURFACE]?.[0]?.line).toBe(0);
  });
});
