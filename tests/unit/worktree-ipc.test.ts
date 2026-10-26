import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import { IPC_CHANNELS } from '../../src/shared/types';

const registeredHandlers = new Map<string, Function>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: Function) => {
      registeredHandlers.set(channel, handler);
    }),
    on: vi.fn(),
  },
  BrowserWindow: {
    getAllWindows: () => [],
    fromWebContents: () => null,
    getFocusedWindow: () => null,
  },
  clipboard: { readText: () => '', writeText: () => {} },
  shell: {},
  dialog: {},
  app: { getPath: () => os.tmpdir(), getVersion: () => '0.0.0' },
  nativeTheme: { on: () => {} },
}));

vi.mock('../../src/shared/instance', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getAppDataDir: () => path.join(os.tmpdir(), 'wmux-worktree-ipc-test'),
}));

const mockCreateWorktree = vi.fn();
const mockRemoveWorktree = vi.fn();
const mockProbeRepo = vi.fn();

vi.mock('../../src/main/git-worktree', () => ({
  createWorktree: (...args: any[]) => mockCreateWorktree(...args),
  removeWorktree: (...args: any[]) => mockRemoveWorktree(...args),
  probeRepo: (...args: any[]) => mockProbeRepo(...args),
}));

import { registerIpcHandlers } from '../../src/main/ipc-handlers';

describe('worktree IPC handlers (#7)', () => {
  let createHandler: Function;
  let removeHandler: Function;
  let probeHandler: Function;

  beforeAll(() => {
    registerIpcHandlers({} as any);
    createHandler = registeredHandlers.get(IPC_CHANNELS.GIT_WORKTREE_CREATE)!;
    removeHandler = registeredHandlers.get(IPC_CHANNELS.GIT_WORKTREE_REMOVE)!;
    probeHandler = registeredHandlers.get(IPC_CHANNELS.GIT_WORKTREE_PROBE)!;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers all 3 worktree IPC handlers', () => {
    expect(createHandler).toBeDefined();
    expect(removeHandler).toBeDefined();
    expect(probeHandler).toBeDefined();
  });

  describe('IPC_CHANNELS.GIT_WORKTREE_CREATE', () => {
    it('rejects non-string repoDir safely', async () => {
      const invalidRepoDirs = [123, null, undefined, {}, [], true];
      for (const repoDir of invalidRepoDirs) {
        const res = await createHandler({}, repoDir, 'feature', 'main');
        expect(res).toEqual({
          ok: false,
          error: 'invalid_argument',
          message: 'Invalid argument types',
        });
      }
      expect(mockCreateWorktree).not.toHaveBeenCalled();
    });

    it('rejects non-string branch safely', async () => {
      const invalidBranches = [123, null, undefined, {}, [], false];
      for (const branch of invalidBranches) {
        const res = await createHandler({}, 'C:\\repo', branch, 'main');
        expect(res).toEqual({
          ok: false,
          error: 'invalid_argument',
          message: 'Invalid argument types',
        });
      }
      expect(mockCreateWorktree).not.toHaveBeenCalled();
    });

    it('rejects non-string non-undefined base safely', async () => {
      const invalidBases = [123, null, {}, [], false];
      for (const base of invalidBases) {
        const res = await createHandler({}, 'C:\\repo', 'feature', base);
        expect(res).toEqual({
          ok: false,
          error: 'invalid_argument',
          message: 'Invalid argument types',
        });
      }
      expect(mockCreateWorktree).not.toHaveBeenCalled();
    });

    it('forwards valid arguments to createWorktree with base ref', async () => {
      const successRecord = {
        ok: true,
        worktree: {
          repoRoot: 'C:\\repo',
          branch: 'feature',
          baseBranch: 'main',
          baseSha: 'abc1234',
          worktreePath: 'C:\\Users\\user\\.wmux\\wt\\repo\\feature-12345678',
        },
      };
      mockCreateWorktree.mockResolvedValueOnce(successRecord);

      const res = await createHandler({}, 'C:\\repo', 'feature', 'main');
      expect(mockCreateWorktree).toHaveBeenCalledWith({
        repoRoot: 'C:\\repo',
        branch: 'feature',
        base: 'main',
      });
      expect(res).toEqual(successRecord);
    });

    it('forwards valid arguments with undefined base', async () => {
      mockCreateWorktree.mockResolvedValueOnce({
        ok: true,
        worktree: {
          repoRoot: 'C:\\repo',
          branch: 'feature',
          baseBranch: 'HEAD',
          baseSha: 'def5678',
          worktreePath: 'C:\\Users\\user\\.wmux\\wt\\repo\\feature-12345678',
        },
      });

      const res = await createHandler({}, 'C:\\repo', 'feature', undefined);
      expect(mockCreateWorktree).toHaveBeenCalledWith({
        repoRoot: 'C:\\repo',
        branch: 'feature',
        base: undefined,
      });
      expect(res.ok).toBe(true);
    });

    it('returns classified errors from createWorktree without throwing', async () => {
      mockCreateWorktree.mockResolvedValueOnce({
        ok: false,
        code: 'branch_exists',
        error: 'Branch already exists',
      });

      const res = await createHandler({}, 'C:\\repo', 'existing-branch');
      expect(res).toEqual({
        ok: false,
        code: 'branch_exists',
        error: 'Branch already exists',
      });
    });

    it('catches unexpected throws and returns spawn_failed', async () => {
      mockCreateWorktree.mockRejectedValueOnce(new Error('git execution crashed'));

      const res = await createHandler({}, 'C:\\repo', 'feature');
      expect(res).toEqual({
        ok: false,
        error: 'spawn_failed',
        message: 'git execution crashed',
      });
    });
  });

  describe('IPC_CHANNELS.GIT_WORKTREE_REMOVE', () => {
    it('rejects non-string worktreePath, logs code only, and returns refused_not_wmux', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const invalidPaths = [123, null, undefined, {}, [], false];

      for (const p of invalidPaths) {
        warnSpy.mockClear();
        const res = await removeHandler({}, p);
        expect(res).toBe('refused_not_wmux');
        expect(warnSpy).toHaveBeenCalledWith('[worktree] remove failed: invalid_argument');
      }

      expect(mockRemoveWorktree).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('forwards valid worktreePath and returns removed without logging warning', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockRemoveWorktree.mockResolvedValueOnce('removed');

      const targetPath = 'C:\\Users\\user\\.wmux\\wt\\repo\\feat-12345678';
      const res = await removeHandler({}, targetPath);

      expect(mockRemoveWorktree).toHaveBeenCalledWith(targetPath);
      expect(res).toBe('removed');
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('logs code only without leaking paths when outcome is not removed', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const secretPath = 'C:\\Users\\sensitive-username\\secret-repo\\.wmux\\wt\\proj\\branch-12345678';
      const outcomes = ['has-work', 'not-ours', 'absent', 'left-behind'];

      for (const outcome of outcomes) {
        warnSpy.mockClear();
        mockRemoveWorktree.mockResolvedValueOnce(outcome);

        const res = await removeHandler({}, secretPath);

        expect(res).toBe(outcome);
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(`[worktree] remove failed: ${outcome}`);

        // Verify the sensitive path was never logged
        for (const call of warnSpy.mock.calls) {
          for (const arg of call) {
            expect(String(arg)).not.toContain(secretPath);
            expect(String(arg)).not.toContain('sensitive-username');
            expect(String(arg)).not.toContain('secret-repo');
          }
        }
      }

      warnSpy.mockRestore();
    });

    it('catches unexpected throws from removeWorktree and returns left_behind', async () => {
      mockRemoveWorktree.mockRejectedValueOnce(new Error('unexpected fs failure'));

      const res = await removeHandler({}, 'C:\\Users\\user\\.wmux\\wt\\repo\\branch');
      expect(res).toBe('left_behind');
    });
  });

  describe('IPC_CHANNELS.GIT_WORKTREE_PROBE', () => {
    it('returns null safely for non-string dir', async () => {
      const invalidDirs = [123, null, undefined, {}, [], false];
      for (const dir of invalidDirs) {
        const res = await probeHandler({}, dir);
        expect(res).toBeNull();
      }
      expect(mockProbeRepo).not.toHaveBeenCalled();
    });

    it('forwards valid dir and returns repoRoot and currentBranch', async () => {
      mockProbeRepo.mockResolvedValueOnce({
        repoRoot: 'C:\\Users\\user\\code\\wmux',
        currentBranch: 'feat/worktrees',
      });

      const res = await probeHandler({}, 'C:\\Users\\user\\code\\wmux\\src');
      expect(mockProbeRepo).toHaveBeenCalledWith('C:\\Users\\user\\code\\wmux\\src');
      expect(res).toEqual({
        repoRoot: 'C:\\Users\\user\\code\\wmux',
        currentBranch: 'feat/worktrees',
      });
    });

    it('returns null when directory is not inside a git repository without logging error', async () => {
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockProbeRepo.mockResolvedValueOnce(null);

      const res = await probeHandler({}, 'C:\\Users\\user\\non-repo-folder');
      expect(res).toBeNull();
      expect(errSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();

      errSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('catches unexpected throws from probeRepo and returns null without throwing', async () => {
      mockProbeRepo.mockRejectedValueOnce(new Error('spawn ENOENT'));

      const res = await probeHandler({}, 'C:\\Users\\user\\broken');
      expect(res).toBeNull();
    });
  });
});
