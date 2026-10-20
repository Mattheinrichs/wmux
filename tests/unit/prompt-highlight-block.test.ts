// @vitest-environment jsdom
//
// The band has to describe the prompt's own text, not the whole terminal row.
// OpenCode's TUI puts its session sidebar in the same terminal grid as the
// transcript, so a full-width decoration paints through it (and a band sized by
// the terminal's width undercounts a wrapped prompt in the narrower chat
// column). These tests model that grid directly.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Terminal } from '@xterm/xterm';
import {
  applyHighlight,
  buildNeedle,
  forgetSurface,
  lineOf,
  locatePromptBlock,
  openMarkAt,
  refineMarkAbove,
} from '../../src/renderer/utils/prompt-marks';

interface FakeDecoration {
  options: Record<string, unknown>;
  disposed: boolean;
  render(): void;
  onRender(cb: (el: HTMLElement) => void): void;
  dispose(): void;
}

function fakeTerminal(rows: string[], cursorLine = rows.length - 1) {
  const decorations: FakeDecoration[] = [];
  const reads = { count: 0 };
  const state = { baseY: 0, cursorY: cursorLine };
  const term = {
    rows: 24,
    cols: 80,
    options: { theme: { background: '#1e1e1e' } },
    buffer: {
      active: {
        get baseY() { return state.baseY; },
        get cursorY() { return state.cursorY; },
        get cursorX() { return 0; },
        getLine: (y: number) => {
          reads.count++;
          return rows[y] === undefined
            ? undefined
            : { translateToString: () => rows[y] };
        },
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
      const callbacks: ((el: HTMLElement) => void)[] = [];
      const decoration: FakeDecoration = {
        options,
        disposed: false,
        render() { for (const cb of callbacks) cb(document.createElement('div')); },
        onRender(cb) { callbacks.push(cb); },
        dispose() { this.disposed = true; },
      };
      decorations.push(decoration);
      return decoration;
    },
  };
  return { term: term as unknown as Terminal, decorations, reads, rows };
}

const SURFACE = 'surf-block';
const PROMPT = 'fix the flaky pty-manager test';

function latest(decorations: FakeDecoration[]): FakeDecoration | undefined {
  return decorations[decorations.length - 1];
}

beforeEach(() => forgetSurface(SURFACE));
afterEach(() => vi.useRealTimers());

describe('the prompt block is the prompt’s own text', () => {
  it('starts after a left sidebar and spans both hard lines', () => {
    const rows = [
      ' session one    │  first line of the prompt',
      ' session two    │  second line of the prompt',
    ];
    const { term } = fakeTerminal(rows);
    const block = locatePromptBlock(term, 0, 'first line of the prompt\nsecond line of the prompt');

    expect(block).not.toBeNull();
    expect(block!.line).toBe(0);
    expect(block!.rows).toBe(2);
    expect(block!.startCol).toBe(rows[0].indexOf('first'));
    expect(block!.endCol).toBe(rows[1].lastIndexOf('prompt') + 'prompt'.length - 1);
    expect(block!.startCol).toBeGreaterThan(rows[0].indexOf('│'));
  });

  it('stops before a right sidebar', () => {
    const row = '│  first line of the prompt                         │ session two';
    const { term } = fakeTerminal([row]);
    const block = locatePromptBlock(term, 0, 'first line of the prompt');

    expect(block).not.toBeNull();
    expect(block!.endCol).toBe(row.indexOf('prompt') + 'prompt'.length - 1);
    expect(block!.endCol).toBeLessThan(row.indexOf('│ session two'));
  });

  it('counts a soft-wrapped prompt as the rows it really occupies', () => {
    const rows = [
      '│  a very long prompt line that',
      '   continues on the next row',
    ];
    const { term } = fakeTerminal(rows);
    const block = locatePromptBlock(term, 0, 'a very long prompt line that continues on the next row');

    expect(block).not.toBeNull();
    expect(block!.rows).toBe(2);
    expect(block!.startCol).toBe(rows[0].indexOf('a'));
    expect(block!.endCol).toBe(Math.max(
      rows[0].lastIndexOf('that') + 'that'.length - 1,
      rows[1].lastIndexOf('row') + 'row'.length - 1,
    ));
  });

  it('spans a blank row inside a multi-paragraph prompt', () => {
    const rows = [
      '│  first paragraph',
      '',
      '│  second paragraph',
    ];
    const { term } = fakeTerminal(rows);
    const block = locatePromptBlock(term, 0, 'first paragraph\n\nsecond paragraph');

    expect(block).not.toBeNull();
    expect(block!.rows).toBe(3);
    expect(block!.endCol).toBe(rows[2].lastIndexOf('paragraph') + 'paragraph'.length - 1);
  });

  it('caps a very long prompt at the highlight row budget instead of dropping it', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1} of a long pasted prompt`);
    const rows = [...lines.map((line) => `│  ${line}`), ''];
    const { term } = fakeTerminal(rows);
    const block = locatePromptBlock(term, 0, lines.join('\n'));

    expect(block).not.toBeNull();
    expect(block!.rows).toBe(24);
  });

  it('finds a block whose first token wraps across rows', () => {
    const rows = [
      '│  https://example.com/a/very',
      '   /long/path/that/wraps',
      '',
    ];
    const { term } = fakeTerminal(rows);
    const block = locatePromptBlock(term, 0, 'https://example.com/a/very/long/path/that/wraps');

    expect(block).not.toBeNull();
    expect(block!.rows).toBe(2);
    expect(block!.startCol).toBe(rows[0].indexOf('https'));
  });

  it('answers null when the rows do not carry the prompt', () => {
    const { term } = fakeTerminal(['│  something else entirely']);
    expect(locatePromptBlock(term, 0, PROMPT)).toBeNull();
  });
});

describe('a live prompt can be refined to its echo above', () => {
  it('moves the mark to the nearest echo above the input row', () => {
    const rows = [
      '│  fix the flaky pty-manager test',
      '  running…',
      `> ${PROMPT}`,
    ];
    const { term } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 2);
    expect(refineMarkAbove(term, SURFACE, 'e1', PROMPT, 2)).toBe(0);
    expect(lineOf(SURFACE, 'e1')).toBe(0);
  });

  it('never moves onto the live row or below it', () => {
    const rows = ['other', `> ${PROMPT}`, 'more'];
    const { term } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 1);
    expect(refineMarkAbove(term, SURFACE, 'e1', PROMPT, 1)).toBeNull();
    expect(lineOf(SURFACE, 'e1')).toBe(1);
  });

  it('answers null when no echo is above yet', () => {
    const rows = ['other', 'more', '> '];
    const { term } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 2);
    expect(refineMarkAbove(term, SURFACE, 'e1', PROMPT, 2)).toBeNull();
  });
});

describe('the decoration is bounded to that block', () => {  it('paints from the prompt text, not from column zero', () => {
    const rows = [` session one │  ${PROMPT}`, ''];
    const { term, decorations } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 1,
      ruler: true,
      needle: buildNeedle(PROMPT),
      confirmed: false,
      text: PROMPT,
    });

    const start = rows[0].indexOf('fix');
    const end = rows[0].lastIndexOf('test') + 'test'.length - 1;
    expect(latest(decorations)?.options.x).toBe(start - 1);
    expect(latest(decorations)?.options.width).toBe(end - (start - 1) + 1);
    expect(latest(decorations)?.options.width).toBeLessThan(80);
  });

  it('sizes a multi-line block from the echoed rows, not the estimate', () => {
    const text = 'first line of the prompt\nsecond line of the prompt';
    const rows = [
      '│  first line of the prompt',
      '│  second line of the prompt',
      '',
    ];
    const { term, decorations } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 1,
      ruler: true,
      needle: buildNeedle(text),
      confirmed: false,
      text,
    });

    expect(latest(decorations)?.options.height).toBe(2);
  });

  it('drops the band when the first row stops carrying the prompt', () => {
    vi.useFakeTimers();
    const rows = [
      '│  first line of the prompt',
      '│  second line of the prompt',
      '',
    ];
    const { term, decorations } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 2,
      ruler: true,
      needle: buildNeedle('first line of the prompt'),
      confirmed: false,
      text: 'first line of the prompt\nsecond line of the prompt',
    });
    const first = latest(decorations)!;
    expect(first.options.backgroundColor).toBeTruthy();

    rows[0] = '│  something else entirely';
    first.render();
    vi.runAllTimers();

    expect(first.disposed).toBe(true);
    expect(latest(decorations)?.options.backgroundColor).toBeUndefined();
    expect(latest(decorations)?.options.overviewRulerOptions).toBeTruthy();
  });

  it('revalidates a rendered band from one row, not by rescanning the block', () => {
    const text = 'first line of the prompt\nsecond line of the prompt';
    const rows = [
      '│  first line of the prompt',
      '│  second line of the prompt',
      '',
    ];
    const { term, decorations, reads } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 2,
      ruler: true,
      needle: buildNeedle(text),
      confirmed: false,
      text,
    });

    reads.count = 0;
    latest(decorations)!.render();
    expect(reads.count).toBe(1);
  });

  it('withholds the tint while the block is still the live input row', () => {
    const rows = [`> ${PROMPT}`];
    const { term, decorations } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 1,
      ruler: true,
      needle: buildNeedle(PROMPT),
      confirmed: false,
      text: PROMPT,
    });

    expect(latest(decorations)?.options.backgroundColor).toBeUndefined();
    expect(latest(decorations)?.options.overviewRulerOptions).toBeTruthy();
  });

  it('withholds a multi-line block whose last row is the cursor', () => {
    const rows = [
      '> first line of the prompt',
      '> second line of the prompt',
      '',
    ];
    const { term, decorations } = fakeTerminal(rows, 1);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 2,
      ruler: true,
      needle: buildNeedle('first line of the prompt'),
      confirmed: false,
      text: 'first line of the prompt\nsecond line of the prompt',
    });

    expect(latest(decorations)?.options.backgroundColor).toBeUndefined();
    expect(latest(decorations)?.options.overviewRulerOptions).toBeTruthy();
  });

  it('tints once the block is entirely above the cursor', () => {
    const rows = [`> ${PROMPT}`, ''];
    const { term, decorations } = fakeTerminal(rows);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 1,
      ruler: true,
      needle: buildNeedle(PROMPT),
      confirmed: false,
      text: PROMPT,
    });

    expect(latest(decorations)?.options.backgroundColor).toBeTruthy();
  });

  it('keeps only the ruler when no block can be found', () => {
    const { term, decorations } = fakeTerminal(['│  something else entirely']);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 3,
      ruler: true,
      needle: buildNeedle(PROMPT),
      confirmed: false,
      text: PROMPT,
    });

    expect(latest(decorations)?.options.backgroundColor).toBeUndefined();
    expect(latest(decorations)?.options.overviewRulerOptions).toBeTruthy();
  });

  it('still withholds a short agent prompt even when the block matches', () => {
    const { term, decorations } = fakeTerminal(['│  yes', '']);
    openMarkAt(term, SURFACE, 'e1', 0);
    applyHighlight(term, SURFACE, 'e1', {
      color: '#6ea8ff',
      rows: 1,
      ruler: true,
      needle: buildNeedle('yes'),
      confirmed: false,
      text: 'yes',
    });

    expect(latest(decorations)?.options.backgroundColor).toBeUndefined();
    expect(latest(decorations)?.options.overviewRulerOptions).toBeTruthy();
  });
});
