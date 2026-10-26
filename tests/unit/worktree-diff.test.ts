import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getChangedFiles, getFileDiff, resetDiffCaches } from '../../src/main/diff-provider';

const execFileAsync = promisify(execFile);

describe('diff-provider with worktree baseRef', () => {
  let tempDir: string;
  let baseSha: string;

  beforeEach(async () => {
    resetDiffCaches();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-diff-test-'));

    const git = async (args: string[]) => {
      await execFileAsync('git', args, { cwd: tempDir });
    };

    await git(['init']);
    await git(['config', 'user.name', 'Tester']);
    await git(['config', 'user.email', 'tester@example.com']);

    // Commit 1 (base commit)
    fs.writeFileSync(path.join(tempDir, 'existing.txt'), 'line 1\nline 2\n');
    await git(['add', 'existing.txt']);
    await git(['commit', '-m', 'initial commit']);

    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: tempDir });
    baseSha = stdout.trim();

    // Commit 2 (on branch / worktree)
    fs.writeFileSync(path.join(tempDir, 'existing.txt'), 'line 1\nline 2 modified\nline 3\n');
    fs.writeFileSync(path.join(tempDir, 'committed-new.txt'), 'hello from worktree\n');
    await git(['add', 'existing.txt', 'committed-new.txt']);
    await git(['commit', '-m', 'worktree commit']);

    // Working directory change (untracked)
    fs.writeFileSync(path.join(tempDir, 'untracked.txt'), 'untracked content\n');
  });

  afterEach(() => {
    resetDiffCaches();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it('without baseRef, only uncommitted changes and untracked files are returned', async () => {
    const files = await getChangedFiles(tempDir);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('untracked.txt');
    expect(paths).not.toContain('existing.txt');
    expect(paths).not.toContain('committed-new.txt');
  });

  it('with baseRef, both committed branch changes and untracked files are returned', async () => {
    const files = await getChangedFiles(tempDir, baseSha);
    const paths = files.map((f) => f.path);
    expect(paths).toContain('existing.txt');
    expect(paths).toContain('committed-new.txt');
    expect(paths).toContain('untracked.txt');

    const existingFile = files.find((f) => f.path === 'existing.txt')!;
    expect(existingFile.status).toBe('modified');
    expect(existingFile.additions).toBeGreaterThan(0);

    const committedNew = files.find((f) => f.path === 'committed-new.txt')!;
    expect(committedNew.status).toBe('added');
  });

  it('getFileDiff with baseRef returns diff against base commit for committed file', async () => {
    const diff = await getFileDiff(tempDir, 'existing.txt', baseSha);
    expect(diff).toContain('-line 2');
    expect(diff).toContain('+line 2 modified');
    expect(diff).toContain('+line 3');
  });
});
