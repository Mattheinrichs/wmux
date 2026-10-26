import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { COMMAND_SPECS } from '../../src/cli/wmux';
import { validateWorkspaceCreateParams, handleBridgeV2 } from '../../src/main/v2-bridge';
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
  });
});
