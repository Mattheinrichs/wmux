/**
 * Lane layout for the commit graph (#362). Pure: commits in, drawing out.
 *
 * Input must be in an order where a commit always precedes its parents
 * (`git log --date-order` or `--topo-order` guarantee it). Each row is drawn
 * as two halves around the commit's dot: the TOP half carries every lane
 * arriving from the row above (bending into the dot when the lane was waiting
 * for this commit), the BOTTOM half every lane leaving toward the row below
 * (fanning out from the dot to each parent).
 *
 * A lane is a slot that "expects" one commit hash. Lanes never shift sideways
 * once assigned — a freed slot is reused by the next new branch instead — so
 * a line stays in one column for as long as it lives, which is what makes a
 * long graph readable while it scrolls.
 */

export interface GraphSegment {
  /** Lane the line starts in (top of the half). */
  from: number;
  /** Lane the line ends in (bottom of the half). */
  to: number;
  half: 'top' | 'bottom';
  /** Palette index. */
  color: number;
}

export interface GraphRow {
  /** Lane of the commit's dot. */
  col: number;
  segments: GraphSegment[];
  /** Lanes in use on this row — the drawing width. */
  width: number;
}

export interface GraphLayout {
  rows: GraphRow[];
  maxWidth: number;
}

interface LayoutCommit {
  hash: string;
  parents: string[];
}

function firstFree(lanes: Array<string | null>): number {
  const idx = lanes.indexOf(null);
  return idx < 0 ? lanes.length : idx;
}

function trimLanes(lanes: Array<string | null>): void {
  while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
}

function topSegments(before: Array<string | null>, hash: string, col: number): GraphSegment[] {
  const segments: GraphSegment[] = [];
  before.forEach((expected, i) => {
    if (expected === null) return;
    segments.push({ from: i, to: expected === hash ? col : i, half: 'top', color: i });
  });
  return segments;
}

/**
 * Point the lanes at this commit's parents and return the lane each parent
 * edge leaves toward. A parent another lane already expects is joined rather
 * than duplicated, so two branches forked from one commit meet at it.
 */
function assignParents(lanes: Array<string | null>, parents: string[], col: number): number[] {
  const targets: number[] = [];
  parents.forEach((parent, index) => {
    const existing = lanes.indexOf(parent);
    if (existing >= 0) { targets.push(existing); return; }
    const lane = index === 0 && lanes[col] === null ? col : firstFree(lanes);
    lanes[lane] = parent;
    targets.push(lane);
  });
  return targets;
}

export function layoutGraph(commits: readonly LayoutCommit[]): GraphLayout {
  const lanes: Array<string | null> = [];
  const rows: GraphRow[] = [];
  let maxWidth = 0;

  for (const commit of commits) {
    let col = lanes.indexOf(commit.hash);
    if (col < 0) col = firstFree(lanes);
    const before = lanes.slice();
    const segments = topSegments(before, commit.hash, col);

    // Every lane that was waiting for this commit ends here.
    for (let i = 0; i < lanes.length; i++) if (lanes[i] === commit.hash) lanes[i] = null;
    while (lanes.length <= col) lanes.push(null);

    const targets = assignParents(lanes, commit.parents, col);
    const fresh = new Set(targets.filter((t) => before[t] === undefined || before[t] === null || before[t] === commit.hash));
    lanes.forEach((expected, i) => {
      if (expected !== null && !fresh.has(i)) segments.push({ from: i, to: i, half: 'bottom', color: i });
    });
    for (const target of targets) segments.push({ from: col, to: target, half: 'bottom', color: target });

    const width = Math.max(before.length, lanes.length, col + 1);
    trimLanes(lanes);
    maxWidth = Math.max(maxWidth, width);
    rows.push({ col, segments, width });
  }

  return { rows, maxWidth };
}
