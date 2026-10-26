import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { COMMAND_SPECS } from '../../src/cli/wmux';
import { validateWorkspaceCreateParams, prepareWorkspaceCreateParams, handleBridgeV2 } from '../../src/main/v2-bridge';
import { initPipeBridge } from '../../src/renderer/pipe-bridge';
import { useStore } from '../../src/renderer/store';

describe('CLI worktree flags and parameter validation', () => {
  it('COMMAND_SPECS new-workspace includes --worktree and --base in value flags', () => {
    const spec = COMMAND_SPECS['new-workspace'];
    expect(spec.value).toContain('--worktree');
    expect(spec.value).toContain('--base');
    expect(spec.usage).toContain('--worktree');
    expect(spec.usage).toContain('--base');
  });

  describe('validateWorkspaceCreateParams', () => {
    it('accepts valid worktree branch names', () => {
      expect(validateWorkspaceCreateParams({ worktree: 'feat/test' })).toBeNull();
      expect(validateWorkspaceCreateParams({ worktree: 'my-feature' })).toBeNull();
      expect(validateWorkspaceCreateParams({ worktree: 'v1.0' })).toBeNull();
      expect(validateWorkspaceCreateParams({})).toBeNull();
      expect(validateWorkspaceCreateParams(undefined)).toBeNull();
    });

    it('rejects invalid worktree branch names', () => {
      expect(validateWorkspaceCreateParams({ worktree: '-rf' })).toContain('Invalid worktree branch name');
      expect(validateWorkspaceCreateParams({ worktree: '--exec=calc' })).toContain('Invalid worktree branch name');
      expect(validateWorkspaceCreateParams({ worktree: 'feat..test' })).toContain('Invalid worktree branch name');
      expect(validateWorkspaceCreateParams({ worktree: 'branch.lock' })).toContain('Invalid worktree branch name');
      expect(validateWorkspaceCreateParams({ worktree: '' })).toContain('Invalid worktree branch name');
      expect(validateWorkspaceCreateParams({ worktree: 123 as any })).toContain('Invalid worktree branch name');
    });
  });

  describe('handleBridgeV2 workspace.create', () => {
    it('responds with -32602 when worktree branch name is invalid', () => {
      const respond = vi.fn();
      const respondError = vi.fn();

      const handled = handleBridgeV2(
        'workspace.create',
        { worktree: '-rf' },
        respond,
        respondError,
      );

      expect(handled).toBe(true);
      expect(respondError).toHaveBeenCalledWith(-32602, expect.stringContaining('Invalid worktree branch name'));
      expect(respond).not.toHaveBeenCalled();
    });
  });

  describe('pipe-bridge __wmux_createWorkspace', () => {
    let mockProbe: ReturnType<typeof vi.fn>;
    let mockCreate: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockProbe = vi.fn().mockResolvedValue({ repoRoot: 'C:\\repo', currentBranch: 'main' });
      mockCreate = vi.fn().mockResolvedValue({
        ok: true,
        worktree: {
          repoRoot: 'C:\\repo',
          branch: 'feat/cli-wt',
          baseBranch: 'main',
          baseSha: '0123456789abcdef0123456789abcdef01234567',
          worktreePath: 'C:\\Users\\User\\AppData\\Local\\wmux\\wt\\repo\\feat-cli-wt',
        },
      });

      (globalThis as any).window = {
        wmux: {
          worktree: {
            probe: mockProbe,
            create: mockCreate,
          },
        },
      };

      useStore.setState({
        workspaces: [],
        activeWorkspaceId: null,
      });

      initPipeBridge();
    });

    afterEach(() => {
      delete (globalThis as any).window;
    });

    it('creates workspace with worktree metadata and worktree path as cwd', async () => {
      const res = await (window as any).__wmux_createWorkspace({
        worktree: 'feat/cli-wt',
        cwd: 'C:\\repo',
      });

      expect(res).toBeDefined();
      expect(res.workspaceId).toBeDefined();

      expect(mockProbe).toHaveBeenCalledWith('C:\\repo');
      expect(mockCreate).toHaveBeenCalledWith('C:\\repo', 'feat/cli-wt', undefined);

      const ws = useStore.getState().workspaces.find((w) => w.id === res.workspaceId);
      expect(ws).toBeDefined();
      expect(ws?.cwd).toBe('C:\\Users\\User\\AppData\\Local\\wmux\\wt\\repo\\feat-cli-wt');
      expect(ws?.worktree?.branch).toBe('feat/cli-wt');
      expect(ws?.title).toBe('feat/cli-wt');
    });

    it('never falls back to the focused workspace when no directory was resolved (#246)', async () => {
      useStore.setState({
        workspaces: [{ id: 'ws-focused', cwd: 'C:\\someone-elses-repo' } as any],
        activeWorkspaceId: 'ws-focused' as any,
      });
      await expect((window as any).__wmux_createWorkspace({ worktree: 'feat/x' }))
        .rejects.toThrow(/pass --cwd/);
      expect(mockProbe).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });

  describe('base ref validation', () => {
    it('refuses a base starting with "-" and other unsafe revisions', () => {
      for (const base of ['-rf', '--upload-pack=calc', 'a..b', 'HEAD:secret', 42]) {
        expect(validateWorkspaceCreateParams({ worktree: 'feat/x', base })).toContain('Invalid base ref');
      }
    });

    it('accepts an omitted base, HEAD~3, a branch and a hash', () => {
      for (const base of [undefined, 'HEAD~3', 'origin/main', 'abc1234']) {
        expect(validateWorkspaceCreateParams({ worktree: 'feat/x', base })).toBeNull();
      }
    });

    it('refuses --base without --worktree', () => {
      expect(validateWorkspaceCreateParams({ base: 'main' })).toContain('only valid with --worktree');
    });

    it('answers -32602 over the pipe for a dash-led base, before any window is asked', () => {
      const respond = vi.fn();
      const respondError = vi.fn();
      handleBridgeV2('workspace.create', { worktree: 'feat/x', base: '--output=x' }, respond, respondError);
      expect(respondError).toHaveBeenCalledWith(-32602, expect.stringContaining('Invalid base ref'));
      expect(respond).not.toHaveBeenCalled();
    });
  });

  describe('prepareWorkspaceCreateParams: the CALLER\'s repository (#246)', () => {
    const rootOf = (id: string) => (id === 'surf-caller' ? { realRoot: 'C:\\callers-repo' } : null);

    it('fills cwd from the calling surface\'s reported folder', () => {
      expect(prepareWorkspaceCreateParams({ worktree: 'feat/x', caller: 'surf-caller' }, rootOf))
        .toEqual({ worktree: 'feat/x', caller: 'surf-caller', cwd: 'C:\\callers-repo' });
    });

    it('an explicit cwd wins over the caller', () => {
      const params = { worktree: 'feat/x', caller: 'surf-caller', cwd: 'C:\\explicit' };
      expect(prepareWorkspaceCreateParams(params, rootOf)).toBe(params);
    });

    it('refuses rather than guesses when neither is known', () => {
      expect(prepareWorkspaceCreateParams({ worktree: 'feat/x' }, rootOf)).toEqual({ error: expect.stringContaining('pass --cwd') });
      expect(prepareWorkspaceCreateParams({ worktree: 'feat/x', caller: 'surf-unknown' }, rootOf)).toEqual({ error: expect.stringContaining('pass --cwd') });
    });

    it('leaves a plain workspace.create untouched', () => {
      const params = { title: 'x', caller: 'surf-caller' };
      expect(prepareWorkspaceCreateParams(params, rootOf)).toBe(params);
    });
  });
});
