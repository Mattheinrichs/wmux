import { describe, it, expect } from 'vitest';
import { create } from 'zustand';
import { createWorkspaceSlice, WorkspaceSlice } from '../../src/renderer/store/workspace-slice';
import { createLeaf, splitNode, workspaceHasTerminalCwd } from '../../src/renderer/store/split-utils';
import type { PaneId, SplitNode } from '../../src/shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// #320: with `explorerOpenByDefault` on, the panel reopened on every workspace
// switch however often it was closed, and it opened in workspaces where it
// could show nothing but "this pane has not reported a working directory yet".
//
// The close is now its own persisted fact (`explorerDismissed`), and auto-open
// waits for a terminal with a directory. Both halves are pinned here: the
// restore path names every field it carries (#145), so a field it forgets is
// dropped silently.
// ─────────────────────────────────────────────────────────────────────────────

function makeStore() {
  return create<WorkspaceSlice>()((...args) => ({ ...createWorkspaceSlice(...args) }));
}

describe('explorerDismissed survives a restore', () => {
  it('is carried through replaceAllWorkspaces', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([
      { title: 'repo', shell: 'pwsh', cwd: 'C:\\repo', explorerDismissed: true },
    ]);
    expect(store.getState().workspaces[0].explorerDismissed).toBe(true);
  });

  it('stays undefined for a session saved before the field existed', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([{ title: 'repo', shell: 'pwsh' }]);
    expect(store.getState().workspaces[0].explorerDismissed).toBeUndefined();
  });

  it('the toggle writes it through updateWorkspaceMetadata', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([{ title: 'repo', shell: 'pwsh' }]);
    const id = store.getState().workspaces[0].id;
    store.getState().updateWorkspaceMetadata(id, { explorerDismissed: true });
    expect(store.getState().workspaces[0].explorerDismissed).toBe(true);
  });
});

function withCwd(tree: SplitNode, cwd: { cwd?: string; currentCwd?: string }): SplitNode {
  if (tree.type !== 'leaf') return tree;
  return { ...tree, surfaces: tree.surfaces.map((s) => ({ ...s, ...cwd })) };
}

describe('workspaceHasTerminalCwd decides whether the explorer may open unasked', () => {
  it('is false while no terminal has a directory', () => {
    expect(workspaceHasTerminalCwd(createLeaf())).toBe(false);
  });

  it('is true for a spawn cwd or a reported one', () => {
    expect(workspaceHasTerminalCwd(withCwd(createLeaf(), { cwd: 'C:\\repo' }))).toBe(true);
    expect(workspaceHasTerminalCwd(withCwd(createLeaf(), { currentCwd: 'C:\\repo' }))).toBe(true);
  });

  it('ignores a non-terminal surface, which the explorer cannot root on', () => {
    expect(workspaceHasTerminalCwd(withCwd(createLeaf(undefined, 'browser'), { cwd: 'C:\\repo' }))).toBe(false);
  });

  it('looks into every pane of a split', () => {
    const left = createLeaf();
    const tree = splitNode(left, left.paneId, 'pane-right' as PaneId, 'terminal', 'horizontal');
    expect(workspaceHasTerminalCwd(tree)).toBe(false);
    if (tree.type === 'leaf') throw new Error('expected a split');
    const withRight: SplitNode = { ...tree, children: [tree.children[0], withCwd(tree.children[1], { currentCwd: 'D:\\wt' })] };
    expect(workspaceHasTerminalCwd(withRight)).toBe(true);
  });
});
