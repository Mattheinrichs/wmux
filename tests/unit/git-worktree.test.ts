import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  isValidBranchName,
  worktreeSlug,
  slugSegment,
  isManagedWorktreePath,
  isValidBaseRef,
  worktreeRoot,
  addArgs,
  removeArgs,
  classifyAddError,
  countStatusEntries,
  STATUS_ARGS,
  SLUG_MAX,
} from '../../src/main/git-worktree';

describe('git-worktree pure functions', () => {
  describe('isValidBranchName', () => {
    const invalidCases = [
      { name: '-rf', desc: 'starts with dash' },
      { name: '--exec=calc', desc: 'starts with double dash' },
      { name: 'a..b', desc: 'contains double dot' },
      { name: 'x.lock', desc: 'ends with .lock' },
      { name: '.hidden', desc: 'starts with dot' },
      { name: '/abs', desc: 'starts with slash' },
      { name: 'feat/', desc: 'ends with trailing slash' },
      { name: 'a b', desc: 'contains space' },
      { name: '', desc: 'empty string' },
      { name: 'a'.repeat(201), desc: '201-character string' },
    ];

    for (const { name, desc } of invalidCases) {
      it(`returns false for ${desc} (${JSON.stringify(name)})`, () => {
        expect(isValidBranchName(name)).toBe(false);
      });
    }

    const validCases = ['feat/ok', 'release-1.2', 'a'];
    for (const name of validCases) {
      it(`returns true for valid branch ${name}`, () => {
        expect(isValidBranchName(name)).toBe(true);
      });
    }
  });

  describe('slugSegment & worktreeSlug', () => {
    it('slugSegment trims, replaces, and respects max length', () => {
      expect(slugSegment('feat/x', SLUG_MAX)).toBe('feat-x');
      expect(slugSegment('a'.repeat(30), 10)).toBe('aaaaaaaaaa');
      expect(slugSegment('')).toBe('');
    });

    it('feat/x vs feat-x on same repo produce different slugs (D5)', () => {
      const repo = '/repos/my-project';
      const slug1 = worktreeSlug(repo, 'feat/x');
      const slug2 = worktreeSlug(repo, 'feat-x');
      expect(slug1).not.toBe(slug2);
    });

    it('same (repoRoot, branch) twice produces identical slug (deterministic)', () => {
      const repo = '/repos/my-project';
      const branch = 'feature/abc';
      const slugA = worktreeSlug(repo, branch);
      const slugB = worktreeSlug(repo, branch);
      expect(slugA).toBe(slugB);
    });

    it('each slug segment is <= SLUG_MAX and total prefix length is bounded', () => {
      const repo = '/repos/very-long-repository-name-that-exceeds-slug-max';
      const branch = 'feature/very-long-branch-name-that-also-exceeds-slug-max';
      const slug = worktreeSlug(repo, branch);
      const [repoSlug, rest] = slug.split('/');
      const branchSlug = rest.slice(0, rest.lastIndexOf('-'));
      expect(repoSlug.length).toBeLessThanOrEqual(SLUG_MAX);
      expect(branchSlug.length).toBeLessThanOrEqual(SLUG_MAX);
      // Bounded relative to the root: the root itself is the user's
      // LOCALAPPDATA, whose length is not ours (the CI runner's is longer).
      // Two segments, a separator, a dash and the 8-char hash.
      expect(slug.length).toBeLessThanOrEqual(2 * SLUG_MAX + 1 + 1 + 8);
    });
  });

  describe('isManagedWorktreePath: exactly <root>/<repo-slug>/<branch-dir>', () => {
    const root = worktreeRoot();

    it('refuses the root, the repo-slug level, anything deeper, outside or relative', () => {
      expect(isManagedWorktreePath(root, root)).toBe(false);
      expect(isManagedWorktreePath(root, path.join(root, 'repo'))).toBe(false);
      expect(isManagedWorktreePath(root, path.join(root, 'repo', 'br-1', 'sub'))).toBe(false);
      expect(isManagedWorktreePath(root, path.join(root, '..', 'wt-other', 'x'))).toBe(false);
      expect(isManagedWorktreePath(root, path.join(root, '..', '..', 'x', 'y'))).toBe(false);
      expect(isManagedWorktreePath(root, 'repo/br-1')).toBe(false);
      expect(isManagedWorktreePath(root, '')).toBe(false);
    });

    it('accepts a path two levels under the root', () => {
      expect(isManagedWorktreePath(root, path.join(root, 'repo', 'br-abc12345'))).toBe(true);
    });
  });

  describe('isValidBaseRef', () => {
    it('accepts omitted, HEAD, branches, HEAD~3 and hashes', () => {
      for (const ref of [undefined, '', 'HEAD', 'main', 'origin/main', 'HEAD~3', 'abc1234']) {
        expect(isValidBaseRef(ref)).toBe(true);
      }
    });

    it('refuses anything that could read as an option, a range or a non-string', () => {
      for (const ref of ['-rf', '--output=x', '--upload-pack=calc', 'a..b', 'HEAD:file', 'a b', 42, null]) {
        expect(isValidBaseRef(ref)).toBe(false);
      }
    });
  });

  describe('countStatusEntries', () => {
    it('counts modified, untracked and ignored entries, a rename once', () => {
      expect(countStatusEntries('')).toBe(0);
      expect(countStatusEntries(' M a.txt\0?? b.txt\0!! .env\0')).toBe(3);
      expect(countStatusEntries('R  new.txt\0old.txt\0 M c\0')).toBe(2);
    });

    it('asks git for ignored and every untracked file', () => {
      expect(STATUS_ARGS).toEqual(expect.arrayContaining(['--ignored', '--untracked-files=all']));
    });
  });

  describe('args builders', () => {
    it('removeArgs(p, false) contains no --force', () => {
      const args = removeArgs('/path/to/wt', false);
      expect(args).not.toContain('--force');
      expect(args).toEqual(['worktree', 'remove', '/path/to/wt']);
    });

    it('removeArgs(p, true) contains --force', () => {
      const args = removeArgs('/path/to/wt', true);
      expect(args).toContain('--force');
      expect(args).toEqual(['worktree', 'remove', '--force', '/path/to/wt']);
    });

    it('addArgs matches expected array', () => {
      expect(addArgs('/wt/path', 'main', 'abc1234')).toEqual([
        'worktree',
        'add',
        '-b',
        'main',
        '/wt/path',
        'abc1234',
      ]);
    });
  });

  describe('classifyAddError', () => {
    it('classifies branch already exists errors', () => {
      expect(classifyAddError("fatal: a branch named 'feat' already exists")).toBe('branch_exists');
      expect(classifyAddError("fatal: already exists")).toBe('branch_exists');
    });

    it('classifies branch in use errors', () => {
      expect(classifyAddError("fatal: 'feat' is already used by worktree at /some/path")).toBe('branch_in_use');
    });

    it('classifies other errors as git_failed', () => {
      expect(classifyAddError("some unknown error")).toBe('git_failed');
      expect(classifyAddError('')).toBe('git_failed');
    });
  });
});
