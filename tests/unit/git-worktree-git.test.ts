/**
 * Integration tests against real repositories on disk (#366).
 *
 * LOCALAPPDATA is pointed at a temp dir, so the worktree root and main's
 * registry (`worktrees.json`) are sandboxed; every git call is real.
 *
 * Pins the safety rules of `src/main/git-worktree.ts`:
 * - F1: `repoRootFor` resolves the main checkout, never the worktree.
 * - Keep refuses (`has-work`) on modified, untracked AND ignored files — an
 *   unforced `git worktree remove` deletes ignored files with exit 0.
 * - A git failure never ends in a recursive delete (`left-behind`).
 * - Only a registered path exactly two levels under the root, listed by git,
 *   is ever touched; anything else is `not-ours` and stays on disk.
 * - Discard deletes the branch MAIN recorded, after a successful removal.
 * - F5: base refs are resolved to SHAs; an option-shaped base is refused.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  repoRootFor,
  resolveBase,
  createWorktree,
  removeWorktree,
  inspectWorktree,
  lookupWorktree,
  worktreeRoot,
  probeRepo,
} from '../../src/main/git-worktree';
import { gitExecutable, worktreeKey } from '../../src/main/git-view';

// The same absolute git the module under test runs.
let GIT = '';
try {
  GIT = gitExecutable();
} catch {
  GIT = '';
}
const hasGit = GIT !== '';

const NO_DRAIN = { drainMs: 0 } as const;

function gitIn(cwd: string, args: string[]): string {
  return execFileSync(GIT, args, { cwd, encoding: 'utf8', windowsHide: true }).trim();
}

function branchExists(repo: string, branch: string): boolean {
  try {
    gitIn(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

describe.runIf(hasGit)('git-worktree integration with real git', { timeout: 60_000 }, () => {
  let tempBase: string;
  let mainRepo: string;
  let savedLocalAppData: string | undefined;
  let savedWmuxInstance: string | undefined;

  async function make(branch: string, base?: string): Promise<string> {
    const res = await createWorktree({ repoRoot: mainRepo, branch, base });
    if (!res.ok) throw new Error(`createWorktree(${branch}) failed: ${res.code} ${res.error}`);
    return res.worktree.worktreePath;
  }

  beforeAll(() => {
    savedLocalAppData = process.env.LOCALAPPDATA;
    savedWmuxInstance = process.env.WMUX_INSTANCE;

    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-wt-git-'));
    process.env.LOCALAPPDATA = tempBase;
    process.env.WMUX_INSTANCE = 'test-git';

    mainRepo = path.join(tempBase, 'main-repo');
    fs.mkdirSync(mainRepo, { recursive: true });
    try {
      gitIn(mainRepo, ['init', '-b', 'main']);
    } catch {
      gitIn(mainRepo, ['init']);
      gitIn(mainRepo, ['checkout', '-b', 'main']);
    }
    gitIn(mainRepo, ['config', 'user.name', 'wmux Tester']);
    gitIn(mainRepo, ['config', 'user.email', 'wmux-tester@example.com']);

    fs.writeFileSync(path.join(mainRepo, '.gitignore'), '.env\n');
    fs.writeFileSync(path.join(mainRepo, 'file.txt'), 'line 1\n');
    gitIn(mainRepo, ['add', '.gitignore', 'file.txt']);
    gitIn(mainRepo, ['commit', '-m', 'Initial commit (c1)']);

    fs.writeFileSync(path.join(mainRepo, 'file.txt'), 'line 1\nline 2\n');
    gitIn(mainRepo, ['add', 'file.txt']);
    gitIn(mainRepo, ['commit', '-m', 'Second commit (c2)']);
  });

  afterAll(async () => {
    if (savedLocalAppData !== undefined) process.env.LOCALAPPDATA = savedLocalAppData;
    else delete process.env.LOCALAPPDATA;
    if (savedWmuxInstance !== undefined) process.env.WMUX_INSTANCE = savedWmuxInstance;
    else delete process.env.WMUX_INSTANCE;
    if (tempBase && fs.existsSync(tempBase)) {
      try {
        await fs.promises.rm(tempBase, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // ignore cleanup error
      }
    }
  });

  describe('F1 — repoRootFor returns the main checkout, never the worktree', () => {
    it('returns the main repository root from inside a linked worktree', async () => {
      const wtPath = await make('feat-f1');
      // Compared as worktreeKey: git answers the LONG path while os.tmpdir() can
      // be an 8.3 short name (`C:\Users\RUNNER~1` on the GitHub runner).
      expect(worktreeKey((await repoRootFor(wtPath))!)).toBe(worktreeKey(mainRepo));
      expect(worktreeKey((await repoRootFor(mainRepo))!)).toBe(worktreeKey(mainRepo));
      expect((await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN })).outcome).toBe('removed');
    });

    it('returns null outside a repository, and for a relative path', async () => {
      const nonRepo = path.join(tempBase, 'empty-dir');
      fs.mkdirSync(nonRepo, { recursive: true });
      expect(await repoRootFor(nonRepo)).toBeNull();
      expect(await repoRootFor('main-repo')).toBeNull();
    });

    it('probeRepo returns repoRoot and branch, or null for non-repo', async () => {
      const probe = await probeRepo(mainRepo);
      expect(worktreeKey(probe!.repoRoot)).toBe(worktreeKey(mainRepo));
      expect(probe!.currentBranch).toBe('main');
      expect(await probeRepo(path.join(tempBase, 'empty-dir'))).toBeNull();
    });
  });

  describe('createWorktree records what main created', () => {
    it('writes a registry record with repo, branch and base SHA', async () => {
      const wtPath = await make('feat-registry', 'HEAD~1');
      const rec = lookupWorktree(wtPath)!;
      expect(rec).not.toBeNull();
      expect(rec.branch).toBe('feat-registry');
      expect(rec.baseBranch).toBe('HEAD~1');
      expect(rec.baseSha).toBe(gitIn(mainRepo, ['rev-parse', 'HEAD~1']));
      expect(worktreeKey(rec.repoRoot)).toBe(worktreeKey(mainRepo));
      // The checkout sits exactly two levels under the root.
      expect(path.relative(worktreeRoot(), wtPath).split(path.sep)).toHaveLength(2);
      await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN });
      expect(lookupWorktree(wtPath)).toBeNull();
    });

    it('refuses a base ref that starts with "-" before running git', async () => {
      for (const base of ['-rf', '--upload-pack=calc', '--output=x']) {
        const res = await createWorktree({ repoRoot: mainRepo, branch: 'feat-dash-base', base });
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.code).toBe('invalid_base');
      }
      expect(branchExists(mainRepo, 'feat-dash-base')).toBe(false);
    });

    it('refuses a branch name that starts with "-"', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: '-D' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('invalid_branch');
    });
  });

  describe('Keep never loses work', () => {
    it('keeps a worktree holding only an IGNORED file (.env), and the file', async () => {
      const wtPath = await make('feat-keep-ignored');
      const envFile = path.join(wtPath, '.env');
      fs.writeFileSync(envFile, 'SECRET=1\n');
      // git itself calls this clean — which is why Keep must not trust it.
      expect(gitIn(wtPath, ['status', '--porcelain'])).toBe('');

      expect(await inspectWorktree(wtPath)).toEqual({ outcome: 'has-work', count: 1 });
      const res = await removeWorktree(wtPath, { mode: 'keep', ...NO_DRAIN });
      expect(res).toEqual({ outcome: 'has-work', count: 1 });
      expect(fs.readFileSync(envFile, 'utf8')).toBe('SECRET=1\n');
      expect(fs.existsSync(path.join(wtPath, '.git'))).toBe(true);
    });

    it('keeps a worktree with a modified tracked file', async () => {
      const wtPath = await make('feat-keep-mod');
      const tracked = path.join(wtPath, 'file.txt');
      fs.appendFileSync(tracked, 'agent modifications\n');
      const res = await removeWorktree(wtPath, { mode: 'keep', ...NO_DRAIN });
      expect(res.outcome).toBe('has-work');
      expect(fs.readFileSync(tracked, 'utf8')).toContain('agent modifications');
    });

    it('keeps a worktree with an untracked file in a subfolder', async () => {
      const wtPath = await make('feat-keep-untracked');
      fs.mkdirSync(path.join(wtPath, 'notes'));
      const untracked = path.join(wtPath, 'notes', 'todo.txt');
      fs.writeFileSync(untracked, 'secret agent notes\n');
      const res = await removeWorktree(wtPath, { mode: 'keep', ...NO_DRAIN });
      expect(res).toEqual({ outcome: 'has-work', count: 1 });
      expect(fs.existsSync(untracked)).toBe(true);
    });

    it('removes a clean worktree and keeps its branch and commits', async () => {
      const wtPath = await make('feat-keep-clean');
      fs.writeFileSync(path.join(wtPath, 'work.txt'), 'agent committed content\n');
      gitIn(wtPath, ['add', 'work.txt']);
      gitIn(wtPath, ['commit', '-m', 'Agent commit on branch']);
      const commitSha = gitIn(mainRepo, ['rev-parse', 'feat-keep-clean']);

      expect(await inspectWorktree(wtPath)).toEqual({ outcome: 'clean' });
      const res = await removeWorktree(wtPath, { mode: 'keep', ...NO_DRAIN });
      expect(res).toEqual({ outcome: 'removed', branchDeleted: false });
      expect(fs.existsSync(wtPath)).toBe(false);
      expect(gitIn(mainRepo, ['rev-parse', '--verify', 'feat-keep-clean'])).toBe(commitSha);
    });
  });

  describe('a git failure never deletes', () => {
    it('Discard of a LOCKED worktree reports left-behind and leaves every file', async () => {
      const wtPath = await make('feat-locked');
      const work = path.join(wtPath, 'precious.txt');
      fs.writeFileSync(work, 'uncommitted work\n');
      gitIn(mainRepo, ['worktree', 'lock', wtPath]);

      const res = await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN });
      expect(res.outcome).toBe('left-behind');
      expect(fs.readFileSync(work, 'utf8')).toBe('uncommitted work\n');
      expect(branchExists(mainRepo, 'feat-locked')).toBe(true);

      gitIn(mainRepo, ['worktree', 'unlock', wtPath]);
      await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN });
    });

    it('Keep of a clean LOCKED worktree reports left-behind and leaves the checkout', async () => {
      const wtPath = await make('feat-locked-keep');
      gitIn(mainRepo, ['worktree', 'lock', wtPath]);
      const res = await removeWorktree(wtPath, { mode: 'keep', ...NO_DRAIN });
      expect(res.outcome).toBe('left-behind');
      expect(fs.existsSync(path.join(wtPath, 'file.txt'))).toBe(true);
      gitIn(mainRepo, ['worktree', 'unlock', wtPath]);
      await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN });
    });

    it('a worktree whose repository is gone is an error, never a delete', async () => {
      const otherRepo = path.join(tempBase, 'doomed-repo');
      fs.mkdirSync(otherRepo);
      gitIn(otherRepo, ['init']);
      gitIn(otherRepo, ['config', 'user.name', 't']);
      gitIn(otherRepo, ['config', 'user.email', 't@example.com']);
      fs.writeFileSync(path.join(otherRepo, 'a.txt'), 'a\n');
      gitIn(otherRepo, ['add', 'a.txt']);
      gitIn(otherRepo, ['commit', '-m', 'a']);
      const res = await createWorktree({ repoRoot: otherRepo, branch: 'orphaned' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const wtPath = res.worktree.worktreePath;
      fs.rmSync(otherRepo, { recursive: true, force: true });

      for (const mode of ['keep', 'discard'] as const) {
        const out = await removeWorktree(wtPath, { mode, ...NO_DRAIN });
        expect(out.outcome).toBe('error');
        expect(fs.existsSync(path.join(wtPath, 'a.txt'))).toBe(true);
      }
    });

    it.runIf(process.platform === 'win32')('a shell holding the folder as cwd leaves it behind, never force-deleted', async () => {
      const wtPath = await make('feat-cwd-held');
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: wtPath,
        stdio: 'ignore',
        windowsHide: true,
      });
      await new Promise((r) => setTimeout(r, 200));
      try {
        const res = await removeWorktree(wtPath, { mode: 'keep', ...NO_DRAIN });
        expect(res.outcome).toBe('left-behind');
        expect(fs.existsSync(wtPath)).toBe(true);
      } finally {
        child.kill();
        await new Promise((resolve) => child.on('exit', resolve));
      }
    });
  });

  describe('only what main created, where main put it', () => {
    it('refuses the root, the repo-slug level and deeper paths', async () => {
      const wtPath = await make('feat-layout');
      for (const p of [worktreeRoot(), path.dirname(wtPath), path.join(wtPath, 'sub')]) {
        expect((await removeWorktree(p, { mode: 'discard', ...NO_DRAIN })).outcome).toBe('not-ours');
        expect(await inspectWorktree(p)).toEqual({ outcome: 'not-ours' });
      }
      expect(fs.existsSync(path.join(wtPath, 'file.txt'))).toBe(true);
      await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN });
    });

    it('refuses a real git worktree OUTSIDE the root, and the main checkout', async () => {
      const external = path.join(tempBase, 'external-worktree');
      gitIn(mainRepo, ['worktree', 'add', '-b', 'feat-external', external, 'HEAD']);
      expect((await removeWorktree(external, { mode: 'discard', ...NO_DRAIN })).outcome).toBe('not-ours');
      expect((await removeWorktree(mainRepo, { mode: 'discard', ...NO_DRAIN })).outcome).toBe('not-ours');
      expect(fs.existsSync(path.join(external, 'file.txt'))).toBe(true);
      expect(branchExists(mainRepo, 'feat-external')).toBe(true);
      gitIn(mainRepo, ['worktree', 'remove', '--force', external]);
    });

    it('refuses an unregistered worktree that sits in the right place', async () => {
      const unregistered = path.join(worktreeRoot(), 'main-repo', 'hand-made-12345678');
      gitIn(mainRepo, ['worktree', 'add', '-b', 'feat-hand-made', unregistered, 'HEAD']);
      expect((await removeWorktree(unregistered, { mode: 'discard', ...NO_DRAIN })).outcome).toBe('not-ours');
      expect(fs.existsSync(path.join(unregistered, 'file.txt'))).toBe(true);
      expect(branchExists(mainRepo, 'feat-hand-made')).toBe(true);
      gitIn(mainRepo, ['worktree', 'remove', '--force', unregistered]);
    });

    it('refuses a registered path git no longer lists as a worktree', async () => {
      const wtPath = await make('feat-unlisted');
      // Detach it from git behind wmux's back: the admin entry goes, the folder stays.
      fs.rmSync(path.join(mainRepo, '.git', 'worktrees', path.basename(wtPath)), { recursive: true, force: true });
      fs.writeFileSync(path.join(wtPath, 'loose.txt'), 'still mine\n');
      expect((await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN })).outcome).toBe('not-ours');
      expect(fs.existsSync(path.join(wtPath, 'loose.txt'))).toBe(true);
    });
  });

  describe('Discard', () => {
    it('force-removes the worktree with its work and deletes the recorded branch', async () => {
      const wtPath = await make('feat-discard');
      fs.writeFileSync(path.join(wtPath, '.env'), 'X=1\n');
      fs.writeFileSync(path.join(wtPath, 'scratch.txt'), 'throwaway\n');
      const res = await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN });
      expect(res).toEqual({ outcome: 'removed', branchDeleted: true });
      expect(fs.existsSync(wtPath)).toBe(false);
      expect(branchExists(mainRepo, 'feat-discard')).toBe(false);
    });

    it('an unknown mode is refused without touching anything', async () => {
      const wtPath = await make('feat-bad-mode');
      const res = await removeWorktree(wtPath, { mode: 'force' as never, ...NO_DRAIN });
      expect(res.outcome).toBe('error');
      expect(fs.existsSync(path.join(wtPath, 'file.txt'))).toBe(true);
      await removeWorktree(wtPath, { mode: 'discard', ...NO_DRAIN });
    });
  });

  describe('F5 — resolveBase', () => {
    it('resolves HEAD~1 to its name and full SHA', async () => {
      const base = await resolveBase(mainRepo, 'HEAD~1');
      expect(base).toEqual({ name: 'HEAD~1', sha: gitIn(mainRepo, ['rev-parse', 'HEAD~1']) });
    });

    it('defaults to HEAD when ref is omitted', async () => {
      const base = await resolveBase(mainRepo);
      expect(base).toEqual({ name: 'HEAD', sha: gitIn(mainRepo, ['rev-parse', 'HEAD']) });
    });

    it('returns null for option injections and unknown refs', async () => {
      expect(await resolveBase(mainRepo, '-rf')).toBeNull();
      expect(await resolveBase(mainRepo, '--all')).toBeNull();
      expect(await resolveBase(mainRepo, 'non-existent-ref-xyz123')).toBeNull();
    });
  });

  describe('D7 — branch existence and branch in use', () => {
    it('returns branch_exists when the branch exists but is not checked out', async () => {
      gitIn(mainRepo, ['branch', 'existing-idle-branch']);
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'existing-idle-branch' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('branch_exists');
    });

    it('returns branch_in_use when the branch is checked out in the main checkout', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'main' });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe('branch_in_use');
    });
  });
});
