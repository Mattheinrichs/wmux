// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { create } from 'zustand';
import { createWorkspaceSlice, WorkspaceSlice } from '../../src/renderer/store/workspace-slice';
import { SURFACE_CLOSED_EVENT } from '../../src/renderer/store/pty-teardown';
import type { PaneId, SplitNode, SurfaceId, SurfaceRef } from '../../src/shared/types';

// ─────────────────────────────────────────────────────────────────────────────
// #361: Load session replaced every workspace without reaping the ones it
// dropped, so each terminal whose surface id was not in the loaded session kept
// its shell (and whatever it had started — a dev server, an agent) running in
// main with no xterm attached until wmux quit. Every other close path has gone
// through pty-teardown since #65; this one did not.
//
// A surface the incoming session ALSO holds is not dropped: since #346 the
// keep-alive host re-parents its live terminal into the new layout, so killing
// it would end a shell the user is about to see again.
// ─────────────────────────────────────────────────────────────────────────────

const term = (id: string): SurfaceRef => ({ id: id as SurfaceId, type: 'terminal' });
const leaf = (paneId: string, surfaces: SurfaceRef[]): SplitNode => ({
  type: 'leaf',
  paneId: paneId as PaneId,
  surfaces,
  activeSurfaceIndex: 0,
});

function makeStore() {
  return create<WorkspaceSlice>()((...args) => ({ ...createWorkspaceSlice(...args) }));
}

describe('replaceAllWorkspaces reaps the surfaces it drops (#361)', () => {
  let kill: ReturnType<typeof vi.fn>;
  let closed: string[];
  let listener: (e: Event) => void;

  beforeEach(() => {
    kill = vi.fn();
    closed = [];
    (globalThis as any).window = { wmux: { pty: { kill } } };
    listener = (e) => closed.push((e as CustomEvent<{ surfaceId: string }>).detail.surfaceId);
    document.addEventListener(SURFACE_CLOSED_EVENT, listener);
  });

  afterEach(() => {
    document.removeEventListener(SURFACE_CLOSED_EVENT, listener);
    delete (globalThis as any).window;
  });

  it('kills the PTY of a terminal the loaded session does not hold', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([
      { title: 'old', splitTree: leaf('pane-a', [term('surf-dropped'), term('surf-kept')]) },
    ]);
    kill.mockClear();
    closed.length = 0;

    store.getState().replaceAllWorkspaces([
      { title: 'new', splitTree: leaf('pane-b', [term('surf-kept'), term('surf-new')]) },
    ]);

    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('surf-dropped');
    expect(closed).toEqual(['surf-dropped']);
  });

  it('announces a dropped non-terminal surface without a PTY kill', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([
      { title: 'old', splitTree: leaf('pane-a', [{ id: 'surf-web' as SurfaceId, type: 'browser' }]) },
    ]);
    kill.mockClear();
    closed.length = 0;

    store.getState().replaceAllWorkspaces([{ title: 'new', splitTree: leaf('pane-b', [term('surf-x')]) }]);

    expect(kill).not.toHaveBeenCalled();
    expect(closed).toEqual(['surf-web']);
  });

  it('kills nothing on a startup restore, where the store starts empty', () => {
    const store = makeStore();
    store.getState().replaceAllWorkspaces([{ title: 'restored', splitTree: leaf('pane-a', [term('surf-1')]) }]);
    expect(kill).not.toHaveBeenCalled();
    expect(closed).toEqual([]);
  });
});
