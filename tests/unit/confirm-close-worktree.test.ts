// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo, WorkspaceId, PaneId, SurfaceId, WorktreeMetadata } from '../../src/shared/types';
import ConfirmWorktreeCloseDialog from '../../src/renderer/components/ConfirmWorktreeCloseDialog';
import { createWorkspaceSlice, WorkspaceSlice } from '../../src/renderer/store/workspace-slice';

const sampleWorktree: WorktreeMetadata = {
  repoRoot: 'C:\\projects\\wmux',
  branch: 'feat/wt-feature',
  baseBranch: 'main',
  baseSha: '0123456789abcdef0123456789abcdef01234567',
  worktreePath: 'C:\\projects\\wmux\\.wmux\\worktrees\\feat-wt-feature',
};

const sampleWs: WorkspaceInfo = {
  id: 'ws-wt-1' as WorkspaceId,
  title: 'feat/wt-feature',
  pinned: false,
  shell: 'pwsh',
  unreadCount: 0,
  worktree: sampleWorktree,
  splitTree: {
    type: 'leaf',
    paneId: 'pane-1' as PaneId,
    activeSurfaceIndex: 0,
    surfaces: [{ id: 's-1' as SurfaceId, type: 'terminal', title: 'term' }],
  },
};

describe('ConfirmWorktreeCloseDialog and store integration', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement;
  let mockRemove: ReturnType<typeof vi.fn>;
  let mockDeleteBranch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRemove = vi.fn().mockResolvedValue({ ok: true });
    mockDeleteBranch = vi.fn().mockResolvedValue({ ok: true });

    (window as any).wmux = {
      worktree: {
        remove: mockRemove,
        deleteBranch: mockDeleteBranch,
      },
    };

    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    document.body.innerHTML = '';
    delete (window as any).wmux;
  });

  it('requestCloseWorkspace routes worktree workspaces into pendingCloseWorktree', () => {
    const store = create<WorkspaceSlice>()((...args) => ({ ...createWorkspaceSlice(...args) }));
    store.setState({ workspaces: [sampleWs] });

    store.getState().requestCloseWorkspace(sampleWs.id);
    expect(store.getState().pendingCloseWorktree).toEqual(sampleWs);
    expect(store.getState().pendingCloseWorkspaceIds).toEqual([]);
  });

  it('renders title and message with branch name when pendingCloseWorktree is set', async () => {
    const { useStore } = await import('../../src/renderer/store');
    useStore.setState({
      workspaces: [sampleWs],
      pendingCloseWorktree: sampleWs,
    });

    await act(async () => {
      root!.render(React.createElement(ConfirmWorktreeCloseDialog));
    });

    expect(container.textContent).toContain('Close worktree workspace');
    expect(container.textContent).toContain("feat/wt-feature");
  });

  it('Keep branch calls remove with { force: false }, keeps branch, and closes workspace', async () => {
    const { useStore } = await import('../../src/renderer/store');
    useStore.setState({
      workspaces: [sampleWs],
      pendingCloseWorktree: sampleWs,
    });

    await act(async () => {
      root!.render(React.createElement(ConfirmWorktreeCloseDialog));
    });

    const keepBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Keep branch'),
    );
    expect(keepBtn).toBeDefined();

    await act(async () => {
      keepBtn!.click();
    });

    expect(mockRemove).toHaveBeenCalledWith(sampleWorktree.worktreePath, { force: false });
    expect(mockDeleteBranch).not.toHaveBeenCalled();
    expect(useStore.getState().pendingCloseWorktree).toBeNull();
    expect(useStore.getState().workspaces.find((w) => w.id === sampleWs.id)).toBeUndefined();
  });

  it('Discard calls remove with { force: true }, deletes branch, and closes workspace', async () => {
    const { useStore } = await import('../../src/renderer/store');
    useStore.setState({
      workspaces: [sampleWs],
      pendingCloseWorktree: sampleWs,
    });

    await act(async () => {
      root!.render(React.createElement(ConfirmWorktreeCloseDialog));
    });

    const discardBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Discard'),
    );
    expect(discardBtn).toBeDefined();

    await act(async () => {
      discardBtn!.click();
    });

    expect(mockRemove).toHaveBeenCalledWith(sampleWorktree.worktreePath, { force: true });
    expect(mockDeleteBranch).toHaveBeenCalledWith(sampleWorktree.repoRoot, sampleWorktree.branch);
    expect(useStore.getState().pendingCloseWorktree).toBeNull();
    expect(useStore.getState().workspaces.find((w) => w.id === sampleWs.id)).toBeUndefined();
  });

  it('Cancel closes dialog without removing or closing workspace', async () => {
    const { useStore } = await import('../../src/renderer/store');
    useStore.setState({
      workspaces: [sampleWs],
      pendingCloseWorktree: sampleWs,
    });

    await act(async () => {
      root!.render(React.createElement(ConfirmWorktreeCloseDialog));
    });

    const cancelBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
      (b) => b.textContent?.includes('Cancel'),
    );
    expect(cancelBtn).toBeDefined();

    await act(async () => {
      cancelBtn!.click();
    });

    expect(mockRemove).not.toHaveBeenCalled();
    expect(mockDeleteBranch).not.toHaveBeenCalled();
    expect(useStore.getState().pendingCloseWorktree).toBeNull();
    expect(useStore.getState().workspaces.find((w) => w.id === sampleWs.id)).toBeDefined();
  });
});
