import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { createWorkspaceSlice, WorkspaceSlice } from '../../src/renderer/store/workspace-slice';
import type { WorktreeMetadata } from '../../src/shared/types';

function makeStore() {
  return create<WorkspaceSlice>()((...args) => ({ ...createWorkspaceSlice(...args) }));
}

const sampleWorktree: WorktreeMetadata = {
  repoRoot: 'C:\\projects\\wmux',
  branch: 'feat/test-branch',
  baseBranch: 'main',
  baseSha: '0123456789abcdef0123456789abcdef01234567',
  worktreePath: 'C:\\projects\\wmux\\.wmux\\worktrees\\feat-test-branch',
};

describe('workspace-slice worktree persistence', () => {
  it('createWorkspace carries worktree metadata when supplied in options', () => {
    const store = makeStore();
    const id = store.getState().createWorkspace({
      title: 'Worktree Workspace',
      worktree: sampleWorktree,
    });
    const ws = store.getState().workspaces.find((w) => w.id === id)!;
    expect(ws.worktree).toEqual(sampleWorktree);
  });

  it('createWorkspace leaves worktree undefined when options omit it', () => {
    const store = makeStore();
    const id = store.getState().createWorkspace({ title: 'Plain Workspace' });
    const ws = store.getState().workspaces.find((w) => w.id === id)!;
    expect(ws.worktree).toBeUndefined();
  });

  it('replaceAllWorkspaces carries worktree metadata when supplied in the workspace configs', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([
      {
        title: 'Restored WT',
        worktree: sampleWorktree,
      },
    ]);
    const ws = store.getState().workspaces[0];
    expect(ws.worktree).toEqual(sampleWorktree);
  });

  it('replaceAllWorkspaces leaves worktree undefined when configs omit it', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([
      {
        title: 'Plain Restored',
      },
    ]);
    const ws = store.getState().workspaces[0];
    expect(ws.worktree).toBeUndefined();
  });
});
