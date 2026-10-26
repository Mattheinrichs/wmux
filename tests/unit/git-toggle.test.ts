import { describe, it, expect } from 'vitest';
import { gitSurfacesIn, toggleGitView, type ToggleGitOps } from '../../src/renderer/components/Git/open-git';
import { findLeaf, getAllPaneIds, removeLeaf } from '../../src/renderer/store/split-utils';
import type { PaneId, SplitNode, SurfaceId, WorkspaceId, WorkspaceInfo } from '../../src/shared/types';

const WS = 'ws-1' as WorkspaceId;
const PANE = 'pane-term' as PaneId;
const NEW_PANE = 'pane-git' as PaneId;

function terminalLeaf(cwd: string): SplitNode {
  return {
    type: 'leaf',
    paneId: PANE,
    surfaces: [{ id: 'surf-term' as SurfaceId, type: 'terminal', currentCwd: cwd }],
    activeSurfaceIndex: 0,
  } as SplitNode;
}

/** A tiny store: the two actions the toggle uses, applied to one workspace. */
function makeOps(tree: SplitNode): ToggleGitOps & { tree: () => SplitNode } {
  const ws = { id: WS, title: 'w', splitTree: tree, cwd: 'C:\\fallback' } as unknown as WorkspaceInfo;
  const ops = {
    workspaces: [ws],
    tree: () => ws.splitTree,
    updateSplitTree: (_id: WorkspaceId, next: SplitNode) => { ws.splitTree = next; },
    closeSurface: (_id: WorkspaceId, paneId: PaneId, surfaceId: SurfaceId) => {
      const leaf = findLeaf(ws.splitTree, paneId)!;
      const rest = leaf.surfaces.filter((s) => s.id !== surfaceId);
      ws.splitTree = rest.length
        ? { ...leaf, surfaces: rest, activeSurfaceIndex: 0 } as SplitNode
        : removeLeaf(ws.splitTree, paneId)!;
    },
  };
  return ops;
}

describe('titlebar Git toggle', () => {
  it('opens the Git view in a pane split to the RIGHT, pinned to the focused terminal folder', () => {
    const ops = makeOps(terminalLeaf('X:\\Dev\\Repo\\Tickr'));
    expect(toggleGitView(ops, WS, PANE, NEW_PANE)).toBe('opened');
    const tree = ops.tree();
    expect(tree.type).toBe('branch');
    expect(tree.type === 'branch' && tree.direction).toBe('horizontal');
    expect(getAllPaneIds(tree)).toEqual([PANE, NEW_PANE]);
    // The terminal the user came from is untouched, still visible on the left.
    expect(findLeaf(tree, PANE)!.surfaces.map((s) => s.type)).toEqual(['terminal']);
    const git = findLeaf(tree, NEW_PANE)!.surfaces[0];
    expect(git.type).toBe('git');
    expect(git.cwd).toBe('X:\\Dev\\Repo\\Tickr');
  });

  it('closes it on the second click and gives the layout back', () => {
    const ops = makeOps(terminalLeaf('X:\\repo'));
    toggleGitView(ops, WS, PANE, NEW_PANE);
    expect(toggleGitView(ops, WS, PANE, 'pane-unused' as PaneId)).toBe('closed');
    expect(getAllPaneIds(ops.tree())).toEqual([PANE]);
    expect(gitSurfacesIn(ops.workspaces[0])).toEqual([]);
  });

  it('closes every Git tab in the workspace, including one opened as a tab with Ctrl+Alt+G', () => {
    const tree = terminalLeaf('X:\\repo');
    if (tree.type === 'leaf') tree.surfaces.push({ id: 'surf-gittab' as SurfaceId, type: 'git' } as never);
    const ops = makeOps(tree);
    expect(gitSurfacesIn(ops.workspaces[0])).toHaveLength(1);
    expect(toggleGitView(ops, WS, PANE, NEW_PANE)).toBe('closed');
    // Only the Git tab went; the terminal sharing its pane stayed.
    expect(findLeaf(ops.tree(), PANE)!.surfaces.map((s) => s.type)).toEqual(['terminal']);
  });

  it('falls back to the workspace folder, and does nothing for an unknown workspace', () => {
    const leaf = terminalLeaf('');
    if (leaf.type === 'leaf') leaf.surfaces[0] = { id: 'surf-term' as SurfaceId, type: 'terminal' } as never;
    const ops = makeOps(leaf);
    toggleGitView(ops, WS, null, NEW_PANE);
    expect(findLeaf(ops.tree(), NEW_PANE)!.surfaces[0].cwd).toBe('C:\\fallback');
    expect(toggleGitView(ops, 'ws-nope' as WorkspaceId, PANE, NEW_PANE)).toBeNull();
  });
});
