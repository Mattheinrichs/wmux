/**
 * Stale glyphs after a width change (#400): rebuild the WebGL renderer once a
 * column change has settled.
 *
 * The report: a pane drew characters that were not in its buffer (a vertical
 * stripe near the old width, fragments at the left edge) while
 * `wmux read-screen` returned the right text, the damage survived new output,
 * and switching workspace and back repaired it.
 *
 * What the workspace switch does is the useful fact. A hidden terminal gives
 * its WebGL addon back (`useTerminal`'s visibility effect) and a shown one
 * loads a NEW one: a fresh render model, fresh vertex buffers, a fresh GL
 * context with every atlas page uploaded again. It is not the `refresh()` that
 * repairs it. The resize path already calls `refresh(0, rows - 1)`, and that
 * cannot repair this class of damage: the WebGL renderer's `_updateModel` skips
 * every cell whose render-model entry already matches the buffer, so a cell
 * whose GPU-side data disagrees with its model entry is never rewritten, by a
 * refresh or by new output that leaves the cell's content unchanged.
 *
 * `terminal.clearTextureAtlas()` is NOT the tool for this, and must not become
 * it: the texture atlas is shared by every terminal with the same font and
 * theme (`CharAtlasCache`), so clearing it from one pane moves glyphs under
 * the vertices of every other pane, which keep pointing at the old positions.
 * That is this bug, in the other panes.
 *
 * So a width change ends with what a workspace switch does: the WebGL addon is
 * replaced. It runs once, on the trailing edge — a divider drag changes the
 * column count every frame, and a GL context per frame is the kind of churn
 * that pushes Chromium towards its context cap. This timer is driven by
 * resizes, never by PTY output (#141).
 */

export const WIDTH_CHANGE_REBUILD_DELAY_MS = 200;

export interface RebuildTimers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const DEFAULT_TIMERS: RebuildTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export class WidthChangeRebuild {
  private timer: unknown = null;

  constructor(
    private readonly rebuild: () => void,
    private readonly delayMs: number = WIDTH_CHANGE_REBUILD_DELAY_MS,
    private readonly timers: RebuildTimers = DEFAULT_TIMERS,
  ) {}

  /**
   * Report a fit. Only a change of COLUMNS arms the rebuild: that is the
   * change the report ties the damage to, and rows-only fits (a font tweak
   * aside) happen on every horizontal split and need nothing.
   */
  noteFit(colsBefore: number, colsAfter: number): void {
    if (colsBefore === colsAfter) return;
    this.cancel();
    this.timer = this.timers.set(() => {
      this.timer = null;
      this.rebuild();
    }, this.delayMs);
  }

  get pending(): boolean {
    return this.timer !== null;
  }

  /** Hidden or unmounted: there is nothing to rebuild. */
  cancel(): void {
    if (this.timer === null) return;
    this.timers.clear(this.timer);
    this.timer = null;
  }
}
