import type { IBufferLine, ILink, ILinkProvider, Terminal } from '@xterm/xterm';
import { FILE_LINK_PREFIX } from './terminal-links';

export interface FilePathCandidate {
  path: string;
  start: number;
  end: number;
}

export const MAX_CANDIDATES_PER_LINE = 20;

const TOKEN = /[^\s"'`<>|()[\]{}]+/g;
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;
const LINE_SUFFIX = /:\d+(?::\d+)?$/;
const EXTENSION = /\.[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*$/;

function trimToken(raw: string): string {
  return raw.replace(TRAILING_PUNCTUATION, '').replace(LINE_SUFFIX, '').replace(TRAILING_PUNCTUATION, '');
}

export function findFilePathCandidates(text: string): FilePathCandidate[] {
  const found: FilePathCandidate[] = [];
  for (const match of text.matchAll(TOKEN)) {
    if (found.length >= MAX_CANDIDATES_PER_LINE) break;
    const raw = match[0];
    if (raw.startsWith('-') || raw.includes('://')) continue;
    const path = trimToken(raw);
    const baseName = path.split(/[\\/]/).pop() ?? '';
    if (!EXTENSION.test(baseName)) continue;
    const start = match.index ?? 0;
    found.push({ path, start, end: start + path.length });
  }
  return found;
}

export function readLineCells(line: IBufferLine, cols: number): { text: string; columns: number[] } {
  let text = '';
  const columns: number[] = [];
  for (let x = 0; x < cols;) {
    const cell = line.getCell(x);
    const chars = cell?.getChars() || ' ';
    for (let i = 0; i < chars.length; i++) columns.push(x);
    text += chars;
    x += cell?.getWidth() || 1;
  }
  return { text, columns };
}

export interface FileLinkHandlers {
  activate: (event: MouseEvent, uri: string) => void;
  hover?: (event: MouseEvent, uri: string) => void;
  leave?: (event: MouseEvent, uri: string) => void;
}

export function createFileLinkProvider(
  terminal: Pick<Terminal, 'buffer' | 'cols'>,
  exists: (path: string) => Promise<boolean>,
  handlers: FileLinkHandlers,
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) return callback(undefined);
      const { text, columns } = readLineCells(line, terminal.cols);
      const candidates = findFilePathCandidates(text);
      if (candidates.length === 0) return callback(undefined);
      Promise.all(candidates.map((c) => exists(c.path).catch(() => false))).then((results) => {
        const links: ILink[] = candidates
          .filter((_, i) => results[i])
          .map((c) => ({
            range: {
              start: { x: columns[c.start] + 1, y: bufferLineNumber },
              end: { x: columns[c.end - 1] + 1, y: bufferLineNumber },
            },
            text: FILE_LINK_PREFIX + c.path,
            decorations: { underline: true, pointerCursor: true },
            activate: handlers.activate,
            hover: handlers.hover,
            leave: handlers.leave,
          }));
        callback(links.length > 0 ? links : undefined);
      });
    },
  };
}
