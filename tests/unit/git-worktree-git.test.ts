/**
 * Integration tests against a real repository on disk (#7).
 *
 * Tests the impure functions in `src/main/git-worktree.ts` against real temporary
 * git repositories created on disk using `fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-wt-git-'))`.
 *
 * Pins:
 * - F1: `repoRootFor` resolves main repository root, never the worktree path.
 * - F2: `removeWorktree` verifies filesystem presence; locked directories report 'left-behind'.
 * - F3: Unforced removal refuses modified or untracked files with 'has-work'.
 * - F4: Worktree removal preserves the branch and its commits.
 * - F5: `resolveBase` resolves 'HEAD~1' to { name, sha }; rejects '-rf' and unknown refs.
 * - D7: Existing uncheckout branch -> 'branch_exists'; branch in use -> 'branch_in_use'.
 * - D4: `reconcileOrphans` removes empty leftovers; keeps unreachable populated worktrees.
 * - Claimed worktrees are never touched by `reconcileOrphans`.
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
  reconcileOrphans,
  worktreeRoot,
  probeRepo,
} from '../../src/main/git-worktree';

let hasGit = false;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
  hasGit = true;
} catch {
  hasGit = false;
}

describe.runIf(hasGit)('git-worktree integration with real git', { timeout: 60_000 }, () => {
  let tempBase: string;
  let mainRepo: string;
  let savedLocalAppData: string | undefined;
  let savedWmuxInstance: string | undefined;

  beforeAll(() => {
    savedLocalAppData = process.env.LOCALAPPDATA;
    savedWmuxInstance = process.env.WMUX_INSTANCE;

    tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-wt-git-'));
    // Isolate worktree root to tempBase
    process.env.LOCALAPPDATA = tempBase;
    process.env.WMUX_INSTANCE = 'test-git';

    mainRepo = path.join(tempBase, 'main-repo');
    fs.mkdirSync(mainRepo, { recursive: true });

    // Initialize main repository with branch 'main'
    try {
      execFileSync('git', ['init', '-b', 'main'], { cwd: mainRepo, windowsHide: true });
    } catch {
      execFileSync('git', ['init'], { cwd: mainRepo, windowsHide: true });
      execFileSync('git', ['checkout', '-b', 'main'], { cwd: mainRepo, windowsHide: true });
    }

    execFileSync('git', ['config', 'user.name', 'wmux Tester'], { cwd: mainRepo, windowsHide: true });
    execFileSync('git', ['config', 'user.email', 'wmux-tester@example.com'], { cwd: mainRepo, windowsHide: true });

    // Commit 1
    fs.writeFileSync(path.join(mainRepo, 'file.txt'), 'line 1\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: mainRepo, windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Initial commit (c1)'], { cwd: mainRepo, windowsHide: true });

    // Commit 2 (so HEAD~1 exists)
    fs.writeFileSync(path.join(mainRepo, 'file.txt'), 'line 1\nline 2\n');
    execFileSync('git', ['add', 'file.txt'], { cwd: mainRepo, windowsHide: true });
    execFileSync('git', ['commit', '-m', 'Second commit (c2)'], { cwd: mainRepo, windowsHide: true });
  });

  afterAll(async () => {
    // Restore environment
    if (savedLocalAppData !== undefined) {
      process.env.LOCALAPPDATA = savedLocalAppData;
    } else {
      delete process.env.LOCALAPPDATA;
    }

    if (savedWmuxInstance !== undefined) {
      process.env.WMUX_INSTANCE = savedWmuxInstance;
    } else {
      delete process.env.WMUX_INSTANCE;
    }

    if (tempBase && fs.existsSync(tempBase)) {
      try {
        await fs.promises.rm(tempBase, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // ignore cleanup error
      }
    }
  });

  describe('F1 — repoRootFor returns main repository root, never worktree path', () => {
    it('returns main repository root from inside a linked worktree', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'feat-f1' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const wtPath = res.worktree.worktreePath;
      const rootFromWt = await repoRootFor(wtPath);
      const rootFromMain = await repoRootFor(mainRepo);

      expect(rootFromWt).not.toBeNull();
      expect(rootFromMain).not.toBeNull();
      expect(rootFromWt!.toLowerCase()).toBe(path.resolve(mainRepo).toLowerCase());
      expect(rootFromWt!.toLowerCase()).not.toBe(path.resolve(wtPath).toLowerCase());
      expect(rootFromMain!.toLowerCase()).toBe(path.resolve(mainRepo).toLowerCase());

      await removeWorktree(wtPath, { force: true, drainMs: 0 });
    });

    it('returns null for a directory that is not inside a git repository', async () => {
      const nonRepo = path.join(tempBase, 'empty-dir');
      fs.mkdirSync(nonRepo, { recursive: true });
      expect(await repoRootFor(nonRepo)).toBeNull();
    });

    it('probeRepo returns repoRoot and branch, or null for non-repo', async () => {
      const probe = await probeRepo(mainRepo);
      expect(probe).not.toBeNull();
      expect(probe!.repoRoot.toLowerCase()).toBe(path.resolve(mainRepo).toLowerCase());
      expect(probe!.currentBranch).toBe('main');

      const nonRepo = path.join(tempBase, 'empty-dir');
      expect(await probeRepo(nonRepo)).toBeNull();
    });
  });

  describe('F2 — removeWorktree verifies filesystem presence against locked directories', () => {
    it('returns left-behind when a child process holds the worktree as CWD', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'feat-f2-lock' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const wtPath = res.worktree.worktreePath;

      // Spawn a background node process whose CWD is the worktree path (locking it on Windows)
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        cwd: wtPath,
        stdio: 'ignore',
        windowsHide: true,
      });

      // Allow the process a moment to initialize and acquire the CWD lock
      await new Promise((r) => setTimeout(r, 150));

      const outcome = await removeWorktree(wtPath, { force: false, drainMs: 0 });
      // On Windows, the locked directory cannot be removed and must report 'left-behind'
      expect(outcome).toBe('left-behind');
      expect(fs.existsSync(wtPath)).toBe(true);

      // Kill the child holding the lock
      child.kill();
      await new Promise((resolve) => child.on('exit', resolve));

      // After releasing the lock, directory can be pruned
      await fs.promises.rm(wtPath, { recursive: true, force: true });
      expect(fs.existsSync(wtPath)).toBe(false);
    });
  });

  describe('F3 — unforced removeWorktree preserves modified or untracked files', () => {
    it('returns has-work and leaves worktree untouched when tracked file is modified', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'feat-f3-mod' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const wtPath = res.worktree.worktreePath;
      const trackedFile = path.join(wtPath, 'file.txt');
      fs.appendFileSync(trackedFile, 'agent modifications\n');

      const outcome = await removeWorktree(wtPath, { force: false, drainMs: 0 });
      expect(outcome).toBe('has-work');
      expect(fs.existsSync(wtPath)).toBe(true);
      expect(fs.readFileSync(trackedFile, 'utf8')).toContain('agent modifications');
      expect(fs.existsSync(path.join(wtPath, '.git'))).toBe(true);

      // Clean up with force
      const forceOutcome = await removeWorktree(wtPath, { force: true, drainMs: 0 });
      expect(forceOutcome).toBe('removed');
    });

    it('returns has-work and leaves worktree untouched when untracked file is present', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'feat-f3-untracked' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const wtPath = res.worktree.worktreePath;
      const untrackedFile = path.join(wtPath, 'untracked.txt');
      fs.writeFileSync(untrackedFile, 'secret agent notes\n');

      const outcome = await removeWorktree(wtPath, { force: false, drainMs: 0 });
      expect(outcome).toBe('has-work');
      expect(fs.existsSync(wtPath)).toBe(true);
      expect(fs.existsSync(untrackedFile)).toBe(true);
      expect(fs.existsSync(path.join(wtPath, '.git'))).toBe(true);

      // Clean up with force
      const forceOutcome = await removeWorktree(wtPath, { force: true, drainMs: 0 });
      expect(forceOutcome).toBe('removed');
    });
  });

  describe('F4 — clean removal preserves branch and commit reachability', () => {
    it('removes worktree directory while branch and commit remain in repository', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'feat-f4-preserve' });
      expect(res.ok).toBe(true);
      if (!res.ok) return;

      const wtPath = res.worktree.worktreePath;
      fs.writeFileSync(path.join(wtPath, 'work.txt'), 'agent committed content\n');
      execFileSync('git', ['add', 'work.txt'], { cwd: wtPath, windowsHide: true });
      execFileSync('git', ['commit', '-m', 'Agent commit on branch'], { cwd: wtPath, windowsHide: true });

      const commitSha = execFileSync('git', ['rev-parse', 'feat-f4-preserve'], {
        cwd: mainRepo,
        encoding: 'utf8',
        windowsHide: true,
      }).trim();

      const outcome = await removeWorktree(wtPath, { force: false, drainMs: 0 });
      expect(outcome).toBe('removed');
      expect(fs.existsSync(wtPath)).toBe(false);

      // Branch still exists and points to commitSha
      const branchSha = execFileSync('git', ['rev-parse', '--verify', 'feat-f4-preserve'], {
        cwd: mainRepo,
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
      expect(branchSha).toBe(commitSha);

      // Commit is still reachable in object database
      expect(() =>
        execFileSync('git', ['cat-file', '-e', commitSha], { cwd: mainRepo, windowsHide: true })
      ).not.toThrow();
    });
  });

  describe('F5 — resolveBase resolves commits and rejects option injections / invalid refs', () => {
    it('resolves HEAD~1 to name and full 40-character commit sha', async () => {
      const base = await resolveBase(mainRepo, 'HEAD~1');
      expect(base).not.toBeNull();
      expect(base!.name).toBe('HEAD~1');

      const expectedSha = execFileSync('git', ['rev-parse', 'HEAD~1'], {
        cwd: mainRepo,
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
      expect(base!.sha).toBe(expectedSha);
    });

    it('defaults to HEAD when ref is omitted', async () => {
      const base = await resolveBase(mainRepo);
      expect(base).not.toBeNull();
      expect(base!.name).toBe('HEAD');

      const expectedSha = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: mainRepo,
        encoding: 'utf8',
        windowsHide: true,
      }).trim();
      expect(base!.sha).toBe(expectedSha);
    });

    it('returns null for option injections like -rf', async () => {
      const base = await resolveBase(mainRepo, '-rf');
      expect(base).toBeNull();
    });

    it('returns null for unknown refs', async () => {
      const base = await resolveBase(mainRepo, 'non-existent-ref-xyz123');
      expect(base).toBeNull();
    });
  });

  describe('D7 — createWorktree branch existence and branch in use error codes', () => {
    it('returns branch_exists when branch exists but is not checked out', async () => {
      execFileSync('git', ['branch', 'existing-idle-branch'], { cwd: mainRepo, windowsHide: true });

      const res = await createWorktree({ repoRoot: mainRepo, branch: 'existing-idle-branch' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('branch_exists');
      }
    });

    it('returns branch_in_use when branch is checked out in main repository', async () => {
      const res = await createWorktree({ repoRoot: mainRepo, branch: 'main' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('branch_in_use');
      }
    });

    it('returns branch_in_use when branch is checked out in an existing worktree', async () => {
      const extWt = path.join(tempBase, 'external-worktree');
      execFileSync('git', ['worktree', 'add', '-b', 'feat-d7-inuse', extWt, 'HEAD'], {
        cwd: mainRepo,
        windowsHide: true,
      });

      const res = await createWorktree({ repoRoot: mainRepo, branch: 'feat-d7-inuse' });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe('branch_in_use');
      }

      execFileSync('git', ['worktree', 'remove', '--force', extWt], { cwd: mainRepo, windowsHide: true });
    });
  });

  describe('D4 — reconcileOrphans sweeps leftovers and keeps unreachable directories', () => {
    it('removes empty leftover directory without .git under worktree root', async () => {
      const emptyDir = path.join(worktreeRoot(), 'orphan-repo', 'empty-leftover');
      fs.mkdirSync(emptyDir, { recursive: true });
      expect(fs.existsSync(emptyDir)).toBe(true);

      const outcomes = await reconcileOrphans([]);
      expect(outcomes).toContainEqual({ outcome: 'removed' });
      expect(fs.existsSync(emptyDir)).toBe(false);
    });

    it('keeps unreachable directory with files whose parent repo was deleted', async () => {
      const unreachableDir = path.join(worktreeRoot(), 'deleted-repo', 'populated-dir');
      fs.mkdirSync(unreachableDir, { recursive: true });
      const preservedFile = path.join(unreachableDir, 'agent-work.txt');
      fs.writeFileSync(preservedFile, 'valuable unsaved agent work\n');

      const outcomes = await reconcileOrphans([]);
      expect(outcomes).toContainEqual({ outcome: 'kept' });
      expect(fs.existsSync(unreachableDir)).toBe(true);
      expect(fs.existsSync(preservedFile)).toBe(true);
    });

    it('never touches a path included in claimed parameter', async () => {
      const claimedEmptyDir = path.join(worktreeRoot(), 'claimed-repo', 'empty-claimed');
      fs.mkdirSync(claimedEmptyDir, { recursive: true });
      expect(fs.existsSync(claimedEmptyDir)).toBe(true);

      const outcomes = await reconcileOrphans([claimedEmptyDir]);
      expect(fs.existsSync(claimedEmptyDir)).toBe(true);
      // Ensure claimed directory was not removed
      expect(outcomes).not.toContainEqual({ outcome: 'removed' });
    });
  });
});
