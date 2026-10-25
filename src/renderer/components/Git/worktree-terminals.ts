/**
 * Which open terminals sit in which worktree (#362) — what the Git view's
 * "Go to worktree terminal" action jumps to. Pure, so the matching rule is
 * testable without a store.
 *
 * Two things make this more than a prefix test:
 *
 * - **Linked worktrees usually live INSIDE the primary one** (`.worktrees/x`,
 *   `.claude/worktrees/x`), so a terminal in a linked worktree is also under
 *   the primary's path. It belongs to the DEEPEST worktree containing it.
 * - **Shells spell the same folder differently.** git prints `C:/repo`, a
 *   PowerShell pane reports `C:\repo`, Git Bash `/c/repo`, a WSL pane
 *   `/mnt/c/repo`. They are folded into one comparison key; the key is never
 *   used as a path.
 */
import type { PaneId, SplitNode, SurfaceId, WorkspaceId, WorkspaceInfo } from '../../../shared/types';

export function pathKey(p: string | undefined | null): string {
  if (!p) return '';
  let s = p.trim();
  const drive = /^\/(?:mnt\/)?([a-zA-Z])(\/.*)?$/.exec(s);
  if (drive) s = `${drive[1]}:${drive[2] ?? '/'}`;
  s = s.replace(/\//g, '\\').toLowerCase();
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}

function isWithin(root: string, candidate: string): boolean {
  if (!root || !candidate) return false;
  if (candidate === root) return true;
  const prefix = root.endsWith('\\') ? root : `${root}\\`;
  return candidate.startsWith(prefix);
}

/** The deepest of `worktreePaths` containing `cwd`, or null. */
export function worktreeForCwd(worktreePaths: readonly string[], cwd: string | undefined | null): string | null {
  const key = pathKey(cwd);
  let best: string | null = null;
  let bestLen = -1;
  for (const wt of worktreePaths) {
    const wtKey = pathKey(wt);
    if (isWithin(wtKey, key) && wtKey.length > bestLen) { best = wt; bestLen = wtKey.length; }
  }
  return best;
}

export interface TerminalLocation {
  workspaceId: WorkspaceId;
  paneId: PaneId;
  surfaceId: SurfaceId;
  cwd: string;
}

function collectTerminals(node: SplitNode, workspaceId: WorkspaceId, out: TerminalLocation[]): void {
  if (node.type === 'leaf') {
    for (const s of node.surfaces) {
      const cwd = s.currentCwd || s.cwd;
      if (s.type === 'terminal' && cwd) out.push({ workspaceId, paneId: node.paneId, surfaceId: s.id, cwd });
    }
    return;
  }
  collectTerminals(node.children[0], workspaceId, out);
  collectTerminals(node.children[1], workspaceId, out);
}

/** worktree path → the terminals whose cwd is in it, in workspace order. */
export function terminalsByWorktree(
  workspaces: readonly WorkspaceInfo[],
  worktreePaths: readonly string[],
): Map<string, TerminalLocation[]> {
  const result = new Map<string, TerminalLocation[]>();
  const all: TerminalLocation[] = [];
  for (const ws of workspaces) collectTerminals(ws.splitTree, ws.id, all);
  for (const term of all) {
    const wt = worktreeForCwd(worktreePaths, term.cwd);
    if (!wt) continue;
    const list = result.get(wt) ?? [];
    list.push(term);
    result.set(wt, list);
  }
  return result;
}
