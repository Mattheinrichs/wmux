import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deleteBranch } from '../../src/main/git-worktree';
import { IPC_CHANNELS } from '../../src/shared/types';

describe('deleteBranch', () => {
  let mockExecFileAsync: any;

  beforeEach(() => {
    mockExecFileAsync = vi.fn().mockResolvedValue({ stdout: 'Deleted branch feature/test\n', stderr: '' });
  });

  describe('IPC_CHANNELS', () => {
    it('defines WORKTREE_DELETE_BRANCH constant', () => {
      expect(IPC_CHANNELS.WORKTREE_DELETE_BRANCH).toBe('worktree:delete-branch');
    });
  });

  describe('branch name validation', () => {
    it('rejects leading dash (flags/options injection)', async () => {
      const invalidBranches = ['-D', '--hard', '-b', '-m', '--delete'];
      for (const branch of invalidBranches) {
        const res = await deleteBranch('C:\\repo', branch, { execFileAsync: mockExecFileAsync });
        expect(res).toEqual({ ok: false, error: 'invalid branch name' });
      }
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('rejects ref traversal with ..', async () => {
      const res = await deleteBranch('C:\\repo', 'feature/../main', { execFileAsync: mockExecFileAsync });
      expect(res).toEqual({ ok: false, error: 'invalid branch name' });
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('rejects branch ending with .lock', async () => {
      const res = await deleteBranch('C:\\repo', 'feature.lock', { execFileAsync: mockExecFileAsync });
      expect(res).toEqual({ ok: false, error: 'invalid branch name' });
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('rejects branch starting with dot or slash', async () => {
      for (const branch of ['.hidden', '/leading-slash']) {
        const res = await deleteBranch('C:\\repo', branch, { execFileAsync: mockExecFileAsync });
        expect(res).toEqual({ ok: false, error: 'invalid branch name' });
      }
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('rejects branch ending with slash', async () => {
      const res = await deleteBranch('C:\\repo', 'trailing-slash/', { execFileAsync: mockExecFileAsync });
      expect(res).toEqual({ ok: false, error: 'invalid branch name' });
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('rejects disallowed characters like spaces, colons, tildes, carets, quotes', async () => {
      const invalid = [
        'feat branch',
        'feat:test',
        'feat~1',
        'feat^2',
        'feat"quote',
        'feat;rm',
        'feat|pipe',
        'feat$var',
      ];
      for (const branch of invalid) {
        const res = await deleteBranch('C:\\repo', branch, { execFileAsync: mockExecFileAsync });
        expect(res).toEqual({ ok: false, error: 'invalid branch name' });
      }
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });

    it('rejects empty or non-string branch name', async () => {
      for (const branch of ['', null as any, undefined as any, 123 as any]) {
        const res = await deleteBranch('C:\\repo', branch, { execFileAsync: mockExecFileAsync });
        expect(res).toEqual({ ok: false, error: 'invalid branch name' });
      }
      expect(mockExecFileAsync).not.toHaveBeenCalled();
    });
  });

  describe('successful execution', () => {
    it('executes git branch -D with array args in repoRoot', async () => {
      const res = await deleteBranch('C:\\projects\\my-repo', 'feature/add-login', {
        execFileAsync: mockExecFileAsync,
      });

      expect(res).toEqual({ ok: true });
      expect(mockExecFileAsync).toHaveBeenCalledTimes(1);
      expect(mockExecFileAsync).toHaveBeenCalledWith(
        'git',
        ['branch', '-D', 'feature/add-login'],
        expect.objectContaining({ cwd: 'C:\\projects\\my-repo' })
      );
    });

    it('allows valid branch characters: alphanumerics, hyphens, underscores, dots, slashes', async () => {
      const validBranches = [
        'main',
        'feat/user-auth_v2.0',
        'fix.123',
        'sub/topic/deep-branch',
      ];
      for (const branch of validBranches) {
        mockExecFileAsync.mockClear();
        const res = await deleteBranch('/var/git/repo', branch, { execFileAsync: mockExecFileAsync });
        expect(res).toEqual({ ok: true });
        expect(mockExecFileAsync).toHaveBeenCalledWith(
          'git',
          ['branch', '-D', branch],
          expect.objectContaining({ cwd: '/var/git/repo' })
        );
      }
    });
  });

  describe('error handling', () => {
    it('returns error without throwing when git command fails', async () => {
      mockExecFileAsync.mockRejectedValue(new Error("error: branch 'feature/not-found' not found."));

      const res = await deleteBranch('C:\\repo', 'feature/not-found', {
        execFileAsync: mockExecFileAsync,
      });

      expect(res).toEqual({
        ok: false,
        error: "error: branch 'feature/not-found' not found.",
      });
    });

    it('returns fallback error string when error message is empty', async () => {
      mockExecFileAsync.mockRejectedValue({});

      const res = await deleteBranch('C:\\repo', 'feature/test', {
        execFileAsync: mockExecFileAsync,
      });

      expect(res).toEqual({
        ok: false,
        error: 'git branch -D failed',
      });
    });

    it('works safely without deps argument provided', async () => {
      const res = await deleteBranch('C:\\nonexistent-repo-path-12345', 'valid-branch');
      expect(res.ok).toBe(false);
      expect(typeof res.error).toBe('string');
    });
  });
});
