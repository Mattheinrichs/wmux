import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveTerminalFileLink, MAX_LINK_TEXT } from '../../src/main/terminal-file-link';

let root: string;
let outside: string;

beforeAll(() => {
  const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-term-link-')));
  root = path.join(base, 'root');
  outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'docs', 'itch', 'devlog'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'itch', 'devlog', '0.5.md'), '# devlog');
  fs.writeFileSync(path.join(root, 'index.ts'), 'export {}');
  fs.writeFileSync(path.join(root, 'cover.png'), 'png');
  fs.writeFileSync(path.join(outside, 'notes.md'), '# notes');
  fs.writeFileSync(path.join(outside, 'secret.ts'), 'nope');
});

afterAll(() => {
  try { fs.rmSync(path.dirname(root), { recursive: true, force: true }); } catch { return; }
});

describe('resolveTerminalFileLink inside the root', () => {
  it('resolves a relative path through the jail with a POSIX relPath', async () => {
    const result = await resolveTerminalFileLink(root, 'docs/itch/devlog/0.5.md');
    expect(result).toEqual({
      kind: 'jailed',
      relPath: 'docs/itch/devlog/0.5.md',
      absPath: path.join(root, 'docs', 'itch', 'devlog', '0.5.md'),
      name: '0.5.md',
      viewable: true,
    });
  });

  it('accepts backslashes and a leading ./', async () => {
    const result = await resolveTerminalFileLink(root, '.\\docs\\itch\\devlog\\0.5.md');
    expect(result).toMatchObject({ kind: 'jailed', relPath: 'docs/itch/devlog/0.5.md' });
  });

  it('turns an absolute path under the root into a jailed one', async () => {
    const result = await resolveTerminalFileLink(root, path.join(root, 'index.ts'));
    expect(result).toMatchObject({ kind: 'jailed', relPath: 'index.ts', viewable: true });
  });

  it('marks a binary file as not viewable so it goes to the default app', async () => {
    const result = await resolveTerminalFileLink(root, 'cover.png');
    expect(result).toMatchObject({ kind: 'jailed', relPath: 'cover.png', viewable: false });
  });

  it('reports a missing file and a directory instead of a link', async () => {
    expect(await resolveTerminalFileLink(root, 'docs/missing.md')).toMatchObject({ code: 'not_found' });
    expect(await resolveTerminalFileLink(root, 'docs')).toMatchObject({ code: 'invalid_path' });
  });
});

describe('resolveTerminalFileLink outside the root', () => {
  it('refuses a non-markdown file reached by climbing out', async () => {
    const result = await resolveTerminalFileLink(root, '../outside/secret.ts');
    expect(result).toMatchObject({ code: 'outside_root' });
  });

  it('refuses a non-markdown absolute path', async () => {
    const result = await resolveTerminalFileLink(root, path.join(outside, 'secret.ts'));
    expect(result).toMatchObject({ code: 'outside_root' });
  });

  it('opens markdown anywhere through the markdown reader', async () => {
    const abs = path.join(outside, 'notes.md');
    expect(await resolveTerminalFileLink(root, abs)).toEqual({ kind: 'markdown', absPath: abs, name: 'notes.md' });
    expect(await resolveTerminalFileLink(root, '../outside/notes.md')).toEqual({ kind: 'markdown', absPath: abs, name: 'notes.md' });
  });

  it('reports markdown outside the root that does not exist', async () => {
    const result = await resolveTerminalFileLink(root, path.join(outside, 'gone.md'));
    expect(result).toMatchObject({ code: 'not_found' });
  });
});

describe('resolveTerminalFileLink without a root', () => {
  it('cannot place a relative path', async () => {
    expect(await resolveTerminalFileLink(null, 'docs/itch/devlog/0.5.md')).toMatchObject({ code: 'outside_root' });
  });

  it('still opens absolute markdown and nothing else', async () => {
    expect(await resolveTerminalFileLink(null, path.join(outside, 'notes.md'))).toMatchObject({ kind: 'markdown' });
    expect(await resolveTerminalFileLink(null, path.join(root, 'index.ts'))).toMatchObject({ code: 'outside_root' });
  });
});

describe('resolveTerminalFileLink never reaches the network', () => {
  // Hover runs this on terminal output a remote host controls: a UNC stat is
  // an SMB connection (NTLM leak) and a main-loop stall on a dead host.
  it.each([
    String.raw`\\evil\share\a.md`,
    '//evil/share/a.md',
    String.raw`\\?\C:\x.md`,
    String.raw`\\.\pipe\x.md`,
  ])('refuses %s with or without a root', async (text) => {
    expect(await resolveTerminalFileLink(root, text)).toMatchObject({ code: 'outside_root' });
    expect(await resolveTerminalFileLink(null, text)).toMatchObject({ code: 'outside_root' });
  });
});

describe('resolveTerminalFileLink input checks', () => {
  it.each([
    ['a number', 42],
    ['an empty string', ''],
    ['a NUL byte', 'index.ts\0.md'],
    ['an oversized string', 'a'.repeat(MAX_LINK_TEXT + 1)],
  ])('refuses %s', async (_label, text) => {
    expect(await resolveTerminalFileLink(root, text)).toMatchObject({ code: 'invalid_path' });
  });
});
