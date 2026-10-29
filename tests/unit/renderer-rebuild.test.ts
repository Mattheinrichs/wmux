import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Issue #400: a pane drew stale glyphs over correct buffer contents after a
// width change, and only a workspace switch repaired it. That switch replaces
// the WebGL addon; a settled column change now does the same.
// ─────────────────────────────────────────────────────────────────────────────

const addons: Array<{ disposed: boolean; contextLoss?: () => void }> = [];

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    disposed = false;
    constructor() { addons.push(this); }
    onContextLoss(cb: () => void): void { (this as { contextLoss?: () => void }).contextLoss = cb; }
    dispose(): void { this.disposed = true; }
  },
}));

const { WidthChangeRebuild } = await import('../../src/renderer/utils/renderer-rebuild');
const { attachVisibleRenderer, rebuildVisibleRenderer, getActiveWebglCount } =
  await import('../../src/renderer/utils/terminal-renderer');

function fakeTerminal() {
  const loaded: unknown[] = [];
  return { loaded, loadAddon: (a: unknown) => { loaded.push(a); }, refresh: vi.fn(), rows: 24 };
}

describe('WidthChangeRebuild', () => {
  let queued: Array<{ fn: () => void; ms: number; cleared: boolean }>;
  let rebuild: ReturnType<typeof vi.fn>;
  let sched: InstanceType<typeof WidthChangeRebuild>;

  beforeEach(() => {
    queued = [];
    rebuild = vi.fn();
    sched = new WidthChangeRebuild(rebuild, 200, {
      set: (fn, ms) => { const t = { fn, ms, cleared: false }; queued.push(t); return t; },
      clear: (h) => { (h as { cleared: boolean }).cleared = true; },
    });
  });

  const fire = () => { for (const t of queued) if (!t.cleared) t.fn(); };

  it('rebuilds once after a column change settles', () => {
    sched.noteFit(102, 204);
    expect(rebuild).not.toHaveBeenCalled();
    expect(sched.pending).toBe(true);
    fire();
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(sched.pending).toBe(false);
  });

  it('ignores a fit that kept the column count (rows-only, or no change)', () => {
    sched.noteFit(204, 204);
    expect(queued).toHaveLength(0);
    expect(sched.pending).toBe(false);
  });

  it('coalesces a divider drag into ONE rebuild on the trailing edge', () => {
    sched.noteFit(102, 110);
    sched.noteFit(110, 150);
    sched.noteFit(150, 204);
    expect(queued.filter((t) => !t.cleared)).toHaveLength(1);
    fire();
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('cancel() drops an armed rebuild (pane hidden or unmounted)', () => {
    sched.noteFit(102, 204);
    sched.cancel();
    fire();
    expect(rebuild).not.toHaveBeenCalled();
    expect(sched.pending).toBe(false);
  });
});

describe('rebuildVisibleRenderer', () => {
  afterEach(() => { addons.length = 0; });

  it('replaces a WebGL addon with a fresh one, without taking a second budget slot', () => {
    const term = fakeTerminal();
    const before = getActiveWebglCount();
    const first = attachVisibleRenderer(term as never);
    expect(first.kind).toBe('webgl');
    expect(getActiveWebglCount()).toBe(before + 1);

    const next = rebuildVisibleRenderer(term as never, first);

    expect(next.kind).toBe('webgl');
    expect(next).not.toBe(first);
    expect(addons).toHaveLength(2);
    expect(addons[0].disposed).toBe(true);
    expect(addons[1].disposed).toBe(false);
    expect(term.loaded).toEqual([addons[0], addons[1]]);
    expect(getActiveWebglCount()).toBe(before + 1);
    next.dispose();
    expect(getActiveWebglCount()).toBe(before);
  });

  it('leaves a DOM renderer alone (nothing to go stale, nothing to load)', () => {
    const term = fakeTerminal();
    const dom = { kind: 'dom' as const, dispose: vi.fn() };
    expect(rebuildVisibleRenderer(term as never, dom)).toBe(dom);
    expect(dom.dispose).not.toHaveBeenCalled();
    expect(term.loaded).toHaveLength(0);
  });
});
