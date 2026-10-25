import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/types';

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  sendSync: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    sendSync: electron.sendSync,
    on: electron.on,
    removeListener: electron.removeListener,
  },
  webUtils: { getPathForFile: electron.getPathForFile },
}));

let bridge: any;

beforeAll(async () => {
  await import('../../src/preload/index');
  bridge = electron.exposeInMainWorld.mock.calls.find(([name]) => name === 'wmux')?.[1];
});

beforeEach(() => {
  electron.invoke.mockReset();
});

describe('worktree preload bridge', () => {
  it('exposes worktree namespace on window.wmux', () => {
    expect(bridge).toBeDefined();
    expect(bridge.worktree).toBeDefined();
  });

  it('forwards create without destination path (D1)', async () => {
    electron.invoke.mockResolvedValue({ ok: true });
    await bridge.worktree.create('C:\\repo', 'feature-branch', 'main');

    expect(electron.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.GIT_WORKTREE_CREATE,
      'C:\\repo',
      'feature-branch',
      'main',
    );
  });

  it('forwards remove with worktreePath', async () => {
    electron.invoke.mockResolvedValue({ ok: true });
    await bridge.worktree.remove('C:\\Users\\user\\.wmux\\worktrees\\slug');

    expect(electron.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.GIT_WORKTREE_REMOVE,
      'C:\\Users\\user\\.wmux\\worktrees\\slug',
    );
  });

  it('forwards probe with directory', async () => {
    electron.invoke.mockResolvedValue({ repoRoot: 'C:\\repo', currentBranch: 'main' });
    const result = await bridge.worktree.probe('C:\\repo\\sub');

    expect(electron.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.GIT_WORKTREE_PROBE,
      'C:\\repo\\sub',
    );
    expect(result).toEqual({ repoRoot: 'C:\\repo', currentBranch: 'main' });
  });
});
