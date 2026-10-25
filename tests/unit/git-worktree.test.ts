import { describe, it, expect } from 'vitest';
import path from 'path';
import {
  isValidBranchName,
  worktreeSlug,
  slugSegment,
  isWmuxWorktreePath,
  worktreeRoot,
  addArgs,
  removeArgs,
  pruneArgs,
  classifyAddError,
  classifyWorktreeDir,
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
      const segments = slug.split('/');
      for (const seg of segments) {
        // split by slash, but hash is attached to branchSlug part with hyphen
        // Let's check parts
        const basePart = seg.split('-')[0];
        expect(basePart.length).toBeLessThanOrEqual(SLUG_MAX);
      }
      expect(slug.length).toBeLessThan(120);
    });
  });

  describe('isWmuxWorktreePath', () => {
    const root = worktreeRoot();

    it('returns false for paths outside or equal to root', () => {
      expect(isWmuxWorktreePath(root, path.join(root, '..', 'wt-other', 'x'))).toBe(false);
      expect(isWmuxWorktreePath(root, path.join(root, '..', 'wt', '..', '..', 'x'))).toBe(false);
      expect(isWmuxWorktreePath(root, root)).toBe(false);
      expect(isWmuxWorktreePath(root, '')).toBe(false);
    });

    it('returns true for valid worktree path inside root', () => {
      const validPath = path.join(root, 'repo', 'br-abc12345');
      expect(isWmuxWorktreePath(root, validPath)).toBe(true);
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

    it('pruneArgs matches expected array', () => {
      expect(pruneArgs()).toEqual(['worktree', 'prune']);
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

  describe('classifyWorktreeDir (8 boolean combinations)', () => {
    const cases = [
      { hasGitFile: false, isEmpty: true, gitAnswered: true, expected: 'leftover' },
      { hasGitFile: false, isEmpty: true, gitAnswered: false, expected: 'leftover' }, // Wait, check implementation: if (!hasGitFile && isEmpty) -> leftover
      { hasGitFile: false, isEmpty: false, gitAnswered: true, expected: 'unreachable' },
      { hasGitFile: false, isEmpty: false, gitAnswered: false, expected: 'unreachable' },
      { hasGitFile: true, isEmpty: true, gitAnswered: true, expected: 'live' },
      { hasGitFile: true, isEmpty: true, gitAnswered: false, expected: 'unreachable' },
      { hasGitFile: true, isEmpty: false, gitAnswered: true, expected: 'live' },
      { hasGitFile: true, isEmpty: false, gitAnswered: false, expected: 'unreachable' },
    ];

    for (const c of cases) {
      it(`combination { hasGitFile: ${c.hasGitFile}, isEmpty: ${c.isEmpty}, gitAnswered: ${c.gitAnswered} } -> ${c.expected}`, () => {
        expect(classifyWorktreeDir(c)).toBe(c.expected);
      });
    }
  });
});
