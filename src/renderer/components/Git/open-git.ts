/**
 * Open (or focus) the project Git view (#362).
 *
 * The tab is pinned to a folder through `SurfaceRef.cwd` when it opens — the
 * focused terminal's live cwd, else the workspace cwd — and never follows
 * focus afterwards: the request is explicitly that reviewing one agent's
 * worktree must not jump when the user clicks into another agent's pane.
 * Any folder inside the repository works as the pin; main asks git for the
 * top level and the worktree list from there.
 */
import type { PaneId, SurfaceId, WorkspaceId, WorkspaceInfo } from '../../../shared/types';
import { findLeaf, getAllPaneIds } from '../../store/split-utils';

export interface OpenGitOps {
  workspaces: WorkspaceInfo[];
  selectSurface: (workspaceId: WorkspaceId, paneId: PaneId, index: number) => void;
  addSurface: (
    workspaceId: WorkspaceId, paneId: PaneId, type: 'git', options?: { cwd?: string },
  ) => SurfaceId | null;
}

/** The folder a new Git tab should be pinned to. */
export function gitRootFor(workspace: WorkspaceInfo, paneId: PaneId | null): string | undefined {
  if (paneId) {
    const leaf = findLeaf(workspace.splitTree, paneId);
    const active = leaf?.surfaces[leaf.activeSurfaceIndex];
    const fromTerminal = leaf?.surfaces.find((s) => s.type === 'terminal' && (s.currentCwd || s.cwd));
    const pick = active?.type === 'terminal' && (active.currentCwd || active.cwd) ? active : fromTerminal;
    const cwd = pick?.currentCwd || pick?.cwd;
    if (cwd) return cwd;
  }
  return workspace.cwd || undefined;
}

/**
 * Focus a Git tab already in `paneId`, else open one there pinned to the
 * focused terminal's folder. One per pane, like the Diff shortcut — a second
 * repository is a second pane or an explicit `wmux new-surface --type git`.
 */
export function openGitView(ops: OpenGitOps, workspaceId: WorkspaceId, paneId: PaneId | null): SurfaceId | null {
  const workspace = ops.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return null;
  const panes = getAllPaneIds(workspace.splitTree);
  const target = paneId && panes.includes(paneId) ? paneId : panes[0];
  if (!target) return null;
  const leaf = findLeaf(workspace.splitTree, target);
  const existing = leaf ? leaf.surfaces.findIndex((s) => s.type === 'git') : -1;
  if (leaf && existing >= 0) {
    ops.selectSurface(workspaceId, target, existing);
    return leaf.surfaces[existing].id;
  }
  const root = gitRootFor(workspace, target);
  return ops.addSurface(workspaceId, target, 'git', root ? { cwd: root } : undefined);
}

export const FOCUS_SURFACE_EVENT = 'wmux:focus-surface';

/** Ask App to focus a surface (workspace, pane and tab). */
export function requestFocusSurface(workspaceId: WorkspaceId, surfaceId: SurfaceId): void {
  document.dispatchEvent(new CustomEvent(FOCUS_SURFACE_EVENT, { detail: { workspaceId, surfaceId } }));
}
