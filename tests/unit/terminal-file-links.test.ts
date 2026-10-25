import { describe, it, expect, vi, beforeEach } from 'vitest';

const { openInWmuxBrowser } = vi.hoisted(() => ({
  openInWmuxBrowser: vi.fn(),
}));

vi.mock('../../src/renderer/utils/open-in-browser', () => ({
  openInWmuxBrowser,
}));

import {
  createFileLinkProvider,
  findFilePathCandidates,
  readLineCells,
  MAX_CANDIDATES_PER_LINE,
} from '../../src/renderer/utils/terminal-file-links';
import {
  FILE_LINK_PREFIX,
  claimsLinkMouseDown,
  createTerminalLinkActivation,
} from '../../src/renderer/utils/terminal-links';

function paths(text: string): string[] {
  return findFilePathCandidates(text).map((c) => c.path);
}

function fakeLine(cells: Array<[string, number]>) {
  return {
    getCell: (x: number) => {
      const cell = cells[x];
      return cell ? { getChars: () => cell[0], getWidth: () => cell[1] } : undefined;
    },
  };
}

function lineOf(text: string) {
  return fakeLine([...text].map((ch) => [ch, 1] as [string, number]));
}

function fakeTerminal(text: string) {
  return {
    cols: text.length,
    buffer: { active: { getLine: (y: number) => (y === 0 ? lineOf(text) : undefined) } },
  } as any;
}

function click(modifiers: Partial<Pick<MouseEvent, 'ctrlKey' | 'metaKey'>> = {}): MouseEvent {
  return { button: 0, ctrlKey: false, metaKey: false, ...modifiers } as MouseEvent;
}

describe('findFilePathCandidates', () => {
  it('finds a relative path inside a sentence with its string offsets', () => {
    const text = 'see docs/itch/devlog/0.5.md for details';
    expect(findFilePathCandidates(text)).toEqual([
      { path: 'docs/itch/devlog/0.5.md', start: 4, end: 27 },
    ]);
  });

  it('drops a trailing line and column suffix and punctuation', () => {
    expect(paths('error at src/main/index.ts:120:4, then')).toEqual(['src/main/index.ts']);
    expect(paths('wrote C:\\Users\\me\\notes.md.')).toEqual(['C:\\Users\\me\\notes.md']);
  });

  it('reads paths wrapped in quotes, backticks and brackets', () => {
    expect(paths('`README.md` and (docs/a.ts) and "b.json"')).toEqual(['README.md', 'docs/a.ts', 'b.json']);
  });

  it('skips urls, flags and bare numbers', () => {
    expect(paths('https://example.com/a.md --out=x.md version 1.5 and 2.0.1')).toEqual([]);
  });

  it('caps the number of candidates per line', () => {
    const text = Array.from({ length: MAX_CANDIDATES_PER_LINE + 5 }, (_, i) => `f${i}.ts`).join(' ');
    expect(findFilePathCandidates(text)).toHaveLength(MAX_CANDIDATES_PER_LINE);
  });
});

describe('readLineCells', () => {
  it('maps every string index to the cell it was drawn in, wide characters included', () => {
    const line = fakeLine([['界', 2], ['', 0], ['a', 1], ['.', 1], ['m', 1], ['d', 1]]) as any;
    const { text, columns } = readLineCells(line, 6);
    expect(text).toBe('界a.md');
    expect(columns).toEqual([0, 2, 3, 4, 5]);
  });
});

describe('createFileLinkProvider', () => {
  it('links only the candidates that exist, with 1-based inclusive cell ranges', async () => {
    const text = 'open docs/a.md or docs/gone.md';
    const exists = vi.fn(async (p: string) => p === 'docs/a.md');
    const handlers = { activate: vi.fn(), hover: vi.fn(), leave: vi.fn() };
    const provider = createFileLinkProvider(fakeTerminal(text), exists, handlers);

    const links = await new Promise<any[] | undefined>((resolve) => provider.provideLinks(1, resolve));

    expect(exists).toHaveBeenCalledTimes(2);
    expect(links).toHaveLength(1);
    expect(links![0].text).toBe(`${FILE_LINK_PREFIX}docs/a.md`);
    expect(links![0].range).toEqual({ start: { x: 6, y: 1 }, end: { x: 14, y: 1 } });
    expect(links![0].activate).toBe(handlers.activate);
  });

  it('answers undefined for a line with no path and never asks main', async () => {
    const exists = vi.fn(async () => true);
    const provider = createFileLinkProvider(fakeTerminal('just words here'), exists, { activate: vi.fn() });
    const links = await new Promise<any[] | undefined>((resolve) => provider.provideLinks(1, resolve));
    expect(links).toBeUndefined();
    expect(exists).not.toHaveBeenCalled();
  });

  it('treats a failed existence check as no link', async () => {
    const exists = vi.fn(async () => { throw new Error('ipc down'); });
    const provider = createFileLinkProvider(fakeTerminal('docs/a.md'), exists, { activate: vi.fn() });
    const links = await new Promise<any[] | undefined>((resolve) => provider.provideLinks(1, resolve));
    expect(links).toBeUndefined();
  });
});

describe('file link activation', () => {
  beforeEach(() => {
    openInWmuxBrowser.mockReset();
  });

  it('opens the path on Ctrl+click and Cmd+click only', () => {
    const openFile = vi.fn();
    const links = createTerminalLinkActivation(() => 'none', openFile);

    links.fileLinkHandlers.activate(click(), `${FILE_LINK_PREFIX}docs/a.md`);
    expect(openFile).not.toHaveBeenCalled();

    links.fileLinkHandlers.activate(click({ ctrlKey: true }), `${FILE_LINK_PREFIX}docs/a.md`);
    links.fileLinkHandlers.activate(click({ metaKey: true }), `${FILE_LINK_PREFIX}docs/b.md`);
    expect(openFile.mock.calls).toEqual([['docs/a.md'], ['docs/b.md']]);
    expect(openInWmuxBrowser).not.toHaveBeenCalled();
  });

  it('does nothing when the terminal has no surface to resolve against', () => {
    const links = createTerminalLinkActivation(() => 'none');
    expect(() => links.activate(click({ ctrlKey: true }), `${FILE_LINK_PREFIX}docs/a.md`)).not.toThrow();
    expect(openInWmuxBrowser).not.toHaveBeenCalled();
  });

  it('claims a Ctrl+click on a file link from a mouse-tracking app', () => {
    const uri = `${FILE_LINK_PREFIX}docs/a.md`;
    expect(claimsLinkMouseDown(click({ ctrlKey: true }), 'vt200', uri)).toBe(true);
    expect(claimsLinkMouseDown(click(), 'vt200', uri)).toBe(false);
    expect(claimsLinkMouseDown(click({ ctrlKey: true }), 'vt200', FILE_LINK_PREFIX)).toBe(false);
  });

  it('opens the claimed file link on release over the same link', () => {
    const openFile = vi.fn();
    const links = createTerminalLinkActivation(() => 'vt200', openFile);
    const uri = `${FILE_LINK_PREFIX}docs/a.md`;
    links.fileLinkHandlers.hover(click(), uri);

    expect(links.claimMouseDown(click({ ctrlKey: true }))).toBe(true);
    expect(links.claimMouseUp(click({ ctrlKey: true }))).toBe(true);
    expect(openFile).toHaveBeenCalledWith('docs/a.md');
  });
});
