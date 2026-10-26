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
  worktreePath: 'C:\\Users\\u\\AppData\\Local\\wmux\\wt\\wmux\\feat-wt-feature-12345678',
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

function button(container: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(
    (b) => b.textContent?.includes(label),
  );
}

describe('ConfirmWorktreeCloseDialog (#366)', () => {
  let root: ReturnType<typeof createRoot> | undefined;
  let container: HTMLDivElement;
  let mockRemove: ReturnType<typeof vi.fn>;
  let mockInspect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRemove = vi.fn().mockResolvedValue({ outcome: 'removed', branchDeleted: false });
    mockInspect = vi.fn().mockResolvedValue({ outcome: 'clean' });
    (window as any).wmux = { worktree: { remove: mockRemove, inspect: mockInspect } };

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

  async function open() {
    const { useStore } = await import('../../src/renderer/store');
    useStore.setState({
      workspaces: [sampleWs],
      activeWorkspaceId: sampleWs.id,
      pendingCloseWorktree: sampleWs,
      notifications: [],
    });
    await act(async () => {
      root!.render(React.createElement(ConfirmWorktreeCloseDialog));
    });
    return useStore;
  }

  it('requestCloseWorkspace routes worktree workspaces into pendingCloseWorktree', () => {
    const store = create<WorkspaceSlice>()((...args) => ({ ...createWorkspaceSlice(...args) }));
    store.setState({ workspaces: [sampleWs] });
    store.getState().requestCloseWorkspace(sampleWs.id);
    expect(store.getState().pendingCloseWorktree).toEqual(sampleWs);
    expect(store.getState().pendingCloseWorkspaceIds).toEqual([]);
  });

  it('a programmatic closeWorkspace (CLI, last tab) never asks main to remove anything', () => {
    const store = create<WorkspaceSlice>()((...args) => ({ ...createWorkspaceSlice(...args) }));
    store.setState({ workspaces: [sampleWs] });
    store.getState().closeWorkspace(sampleWs.id);
    expect(store.getState().workspaces).toEqual([]);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('inspects the folder while the workspace is still open, and spells out Discard', async () => {
    await open();
    expect(mockInspect).toHaveBeenCalledWith(sampleWorktree.worktreePath);
    expect(container.textContent).toContain('Close worktree workspace');
    expect(container.textContent).toContain('feat/wt-feature');
    expect(container.textContent).toMatch(/uncommitted changes, ignored files .* and commits not merged/);
  });

  it('clean: Keep branch closes the workspace, then removes in keep mode and reports it', async () => {
    const useStore = await open();
    await act(async () => { button(container, 'Keep branch')!.click(); });

    expect(mockRemove).toHaveBeenCalledWith(sampleWorktree.worktreePath, 'keep');
    expect(useStore.getState().pendingCloseWorktree).toBeNull();
    expect(useStore.getState().workspaces.find((w) => w.id === sampleWs.id)).toBeUndefined();
    expect(useStore.getState().notifications.at(-1)?.text).toContain("Worktree 'feat/wt-feature' removed; the branch was kept.");
  });

  it('has-work: no remove is offered; closing leaves the folder on disk', async () => {
    mockInspect.mockResolvedValue({ outcome: 'has-work', count: 3 });
    const useStore = await open();

    expect(container.textContent).toContain('3 modified, untracked or ignored');
    expect(button(container, 'Keep branch')).toBeUndefined();
    expect(button(container, 'Discard')).toBeDefined();

    await act(async () => { button(container, 'Close, keep folder')!.click(); });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(useStore.getState().workspaces.find((w) => w.id === sampleWs.id)).toBeUndefined();
  });

  it('a pre-flight error keeps the workspace open and offers no removal at all', async () => {
    mockInspect.mockResolvedValue({ outcome: 'error', message: 'git not found' });
    const useStore = await open();

    expect(container.textContent).toContain('git not found');
    expect(button(container, 'Keep branch')).toBeUndefined();
    expect(button(container, 'Discard')).toBeUndefined();
    await act(async () => { button(container, 'Cancel')!.click(); });
    expect(useStore.getState().workspaces.find((w) => w.id === sampleWs.id)).toBeDefined();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('not-ours: offers only Cancel and Close, keep folder', async () => {
    mockInspect.mockResolvedValue({ outcome: 'not-ours' });
    await open();
    expect(button(container, 'Keep branch')).toBeUndefined();
    expect(button(container, 'Discard')).toBeUndefined();
    expect(button(container, 'Close, keep folder')).toBeDefined();
  });

  it('Discard sends the discard mode explicitly and reports the deleted branch', async () => {
    mockRemove.mockResolvedValue({ outcome: 'removed', branchDeleted: true });
    const useStore = await open();
    await act(async () => { button(container, 'Discard')!.click(); });

    expect(mockRemove).toHaveBeenCalledWith(sampleWorktree.worktreePath, 'discard');
    expect(useStore.getState().notifications.at(-1)?.text).toContain('and its branch were deleted');
  });

  it('a removal that fails after the close is reported, not swallowed', async () => {
    mockRemove.mockResolvedValue({ outcome: 'left-behind', message: 'Permission denied' });
    const useStore = await open();
    await act(async () => { button(container, 'Keep branch')!.click(); });
    expect(useStore.getState().notifications.at(-1)?.text).toContain('was left on disk: Permission denied');
  });

  it('Cancel closes the dialog without removing or closing the workspace', async () => {
    const useStore = await open();
    await act(async () => { button(container, 'Cancel')!.click(); });
    expect(mockRemove).not.toHaveBeenCalled();
    expect(useStore.getState().pendingCloseWorktree).toBeNull();
    expect(useStore.getState().workspaces.find((w) => w.id === sampleWs.id)).toBeDefined();
  });
});
