import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../../src/renderer/components/Git/git-graph-layout';
import { pathKey, terminalsByWorktree, worktreeForCwd } from '../../src/renderer/components/Git/worktree-terminals';
import { refBadges } from '../../src/renderer/components/Git/GitGraphView';
import type { WorkspaceInfo } from '../../src/shared/types';

// The commit graph (#362). Rows are drawn from segments, so the assertions are
// about lanes: a straight history is one lane, a fork opens a second lane that
// stays in its column, and a merge closes it back into the first.

const c = (hash: string, ...parents: string[]) => ({ hash, parents });

describe('layoutGraph', () => {
  it('keeps a linear history in one lane', () => {
    const { rows, maxWidth } = layoutGraph([c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')]);
    expect(rows.map((r) => r.col)).toEqual([0, 0, 0, 0]);
    expect(maxWidth).toBe(1);
    // Root commit: nothing leaves below it.
    expect(rows[3].segments.filter((s) => s.half === 'bottom')).toEqual([]);
    // Every middle row: one line in from above, one line out below.
    expect(rows[1].segments).toEqual([
      { from: 0, to: 0, half: 'top', color: 0 },
      { from: 0, to: 0, half: 'bottom', color: 0 },
    ]);
  });

  it('opens a lane for a second branch tip and merges it back', () => {
    // m merges feature (f2) into main (b); both fork from a.
    //   m        (lane 0)
    //   | \
    //   b  f2    (lanes 0, 1)
    //   |  f1
    //   | /
    //   a
    const { rows, maxWidth } = layoutGraph([
      c('m', 'b', 'f2'), c('f2', 'f1'), c('b', 'a'), c('f1', 'a'), c('a'),
    ]);
    expect(maxWidth).toBe(2);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 1, 0]);
    // The merge fans out to both parents.
    expect(rows[0].segments.filter((s) => s.half === 'bottom')).toEqual([
      { from: 0, to: 0, half: 'bottom', color: 0 },
      { from: 0, to: 1, half: 'bottom', color: 1 },
    ]);
    // f1's parent is already awaited by lane 0, so the feature lane JOINS it
    // right below f1 instead of keeping a second lane alive down to a.
    expect(rows[3].segments).toContainEqual({ from: 1, to: 0, half: 'bottom', color: 0 });
    expect(rows[4].segments).toEqual([{ from: 0, to: 0, half: 'top', color: 0 }]);
  });

  it('gives an unrelated branch tip its own lane without moving the first', () => {
    const { rows } = layoutGraph([c('x', 'a'), c('y', 'a'), c('a')]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0]);
    // Row of y: lane 0 (waiting for a) passes straight through.
    expect(rows[1].segments).toContainEqual({ from: 0, to: 0, half: 'top', color: 0 });
    expect(rows[1].segments).toContainEqual({ from: 0, to: 0, half: 'bottom', color: 0 });
  });

  it('reuses a freed lane instead of growing', () => {
    // Two branches that each end (root) — the second root reuses lane 0's slot.
    const { maxWidth } = layoutGraph([c('a'), c('b'), c('c')]);
    expect(maxWidth).toBe(1);
  });
});

describe('refBadges', () => {
  const known = { local: ['main'], remote: ['origin/main'], tags: ['v1'] };
  it('labels HEAD, branches, remotes and tags, and drops origin/HEAD', () => {
    expect(refBadges(['HEAD -> main', 'origin/main', 'origin/HEAD', 'tag: v1', 'feature'], known)).toEqual([
      { label: 'main', kind: 'head' },
      { label: 'origin/main', kind: 'remote' },
      { label: 'v1', kind: 'tag' },
      { label: 'feature', kind: 'local' },
    ]);
  });
});

describe('worktree terminals', () => {
  it('folds every shell spelling of one folder together', () => {
    const want = 'c:\\users\\me\\repo';
    for (const p of ['C:/Users/me/repo', 'C:\\Users\\me\\repo\\', '/c/Users/me/repo', '/mnt/c/Users/me/repo']) {
      expect(pathKey(p)).toBe(want);
    }
  });

  it('assigns a cwd to the DEEPEST worktree containing it', () => {
    const wts = ['C:/repo', 'C:/repo/.worktrees/agent'];
    expect(worktreeForCwd(wts, 'C:\\repo\\src')).toBe('C:/repo');
    expect(worktreeForCwd(wts, 'C:\\repo\\.worktrees\\agent\\src')).toBe('C:/repo/.worktrees/agent');
    expect(worktreeForCwd(wts, 'C:\\repository')).toBeNull(); // a prefix is not containment
    expect(worktreeForCwd(wts, undefined)).toBeNull();
  });

  it('maps terminals across workspaces, ignoring non-terminal tabs', () => {
    const leaf = (paneId: string, surfaces: any[]) => ({ type: 'leaf', paneId, surfaces, activeSurfaceIndex: 0 });
    const workspaces = [
      { id: 'ws-1', splitTree: { type: 'branch', direction: 'horizontal', ratio: 0.5, children: [
        leaf('pane-a', [{ id: 'surf-1', type: 'terminal', currentCwd: '/c/repo/.worktrees/agent' }]),
        leaf('pane-b', [{ id: 'surf-2', type: 'terminal', cwd: 'C:\\repo' }, { id: 'surf-3', type: 'git', cwd: 'C:\\repo' }]),
      ] } },
    ] as unknown as WorkspaceInfo[];
    const map = terminalsByWorktree(workspaces, ['C:/repo', 'C:/repo/.worktrees/agent']);
    expect(map.get('C:/repo/.worktrees/agent')?.map((t) => t.surfaceId)).toEqual(['surf-1']);
    expect(map.get('C:/repo')?.map((t) => t.surfaceId)).toEqual(['surf-2']);
  });
});
