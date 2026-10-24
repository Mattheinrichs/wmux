/**
 * One live terminal per surface for the surface's whole life (issue #346).
 *
 * A split-tree change remounts every pane whose position in the tree moved —
 * `SplitContainer` keys branch children by tree shape, zoom swaps the root, a
 * tab dragged to another pane lands under a different parent — and a remount
 * used to mean a NEW xterm. Everything the old emulator knew then had to be
 * carried across by hand: the buffer (#49), mouse modes (#164), ConPTY's cursor
 * row (#216, #256), the alternate screen (#345). Prompt markers, cursor style
 * and the scroll region never made it. Each was found by a user hitting a
 * broken pane after a layout change, and the list only grew.
 *
 * So the terminal no longer lives where the pane is. `TerminalPane` is rendered
 * once per surface, into a detached element this registry owns (`entry.el`),
 * by a host that never remounts; the pane only holds a SLOT, and the element is
 * moved into whichever slot currently shows that surface. The emulator, its
 * addons, its decorations and its PTY subscription never notice the move.
 *
 * Three states, and why each exists:
 *
 * - **claimed** — a slot holds the element. The host renders the slot's props.
 * - **parked** — no slot holds it but the surface still exists (the other
 *   panes of a zoomed workspace, or the instant between one slot's cleanup and
 *   the next slot's claim inside the same commit). The element goes to an
 *   off-screen parking root at the SAME pixel size it last had: a size change
 *   would fire the terminal's ResizeObserver, and a 0×0 fit proposes a 2-column
 *   terminal and resizes the PTY to it. Props are rewritten to "not visible,
 *   not focused", which releases the WebGL context like a hidden tab does.
 * - **dropped** — parked AND the surface is gone from the store. Only then does
 *   the host unmount `TerminalPane`, which disposes the emulator.
 *
 * Pure apart from the DOM elements it moves, so it is testable without React.
 */

export interface KeepAliveEntry<P> {
  readonly id: string;
  /** The element `TerminalPane` is portalled into. Moves between slots. */
  readonly el: HTMLElement;
  props: P;
  /** The slot currently holding `el`, or null while parked. */
  owner: object | null;
  /**
   * Bumped on every claim. A same-commit move (release then claim) leaves the
   * props unchanged, so nothing in the terminal would otherwise know it moved:
   * this is what re-runs its refit / repaint / refocus.
   */
  generation: number;
}

export interface KeepAliveOptions<P> {
  /** Does the surface still exist anywhere in this window's store? */
  isAlive: (id: string) => boolean;
  /** The props a parked terminal gets — not visible, not focused. */
  parkedProps: (props: P) => P;
  /** Where parked elements wait. Created lazily; injectable for tests. */
  parkingRoot?: () => HTMLElement;
  /** Deferral for the drop of a dead surface; injectable for tests. */
  defer?: (fn: () => void) => void;
}

type Listener = () => void;

function defaultParkingRoot(): HTMLElement {
  const existing = document.getElementById('wmux-terminal-parking');
  if (existing) return existing;
  const root = document.createElement('div');
  root.id = 'wmux-terminal-parking';
  root.setAttribute('aria-hidden', 'true');
  // Laid out (so the parked terminal keeps its size) but never seen or hit.
  root.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;';
  document.body.appendChild(root);
  return root;
}

function fillSlot(el: HTMLElement): void {
  el.style.width = '100%';
  el.style.height = '100%';
}

export class TerminalKeepAlive<P> {
  private readonly entries = new Map<string, KeepAliveEntry<P>>();
  private readonly listeners = new Set<Listener>();
  private readonly entryListeners = new Map<string, Set<Listener>>();
  private snapshot: readonly string[] = [];

  constructor(private readonly options: KeepAliveOptions<P>) {}

  /** Surface ids with a live terminal, as a stable array for useSyncExternalStore. */
  ids = (): readonly string[] => this.snapshot;

  get(id: string): KeepAliveEntry<P> | undefined {
    return this.entries.get(id);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  subscribeEntry(id: string, listener: Listener): () => void {
    const set = this.entryListeners.get(id) ?? new Set<Listener>();
    this.entryListeners.set(id, set);
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.entryListeners.delete(id);
    };
  }

  /** Put the surface's terminal into `slot`, creating it on first use. */
  claim(id: string, owner: object, slot: HTMLElement, props: P): void {
    let entry = this.entries.get(id);
    const created = !entry;
    if (!entry) {
      const el = document.createElement('div');
      el.className = 'kept-terminal';
      entry = { id, el, props, owner: null, generation: 0 };
      this.entries.set(id, entry);
    }
    fillSlot(entry.el);
    if (entry.el.parentElement !== slot) slot.appendChild(entry.el);
    entry.owner = owner;
    entry.props = props;
    entry.generation += 1;
    if (created) this.publishIds();
    this.notifyEntry(id);
  }

  /** New props from the slot that holds the terminal. A stale slot is ignored. */
  update(id: string, owner: object, props: P): void {
    const entry = this.entries.get(id);
    if (!entry || entry.owner !== owner) return;
    if (shallowEqual(entry.props, props)) return;
    entry.props = props;
    this.notifyEntry(id);
  }

  /** The slot is going away: park the terminal, or drop it if its surface is gone. */
  release(id: string, owner: object): void {
    const entry = this.entries.get(id);
    // Another slot already claimed it (a move whose claim ran first): not ours.
    if (!entry || entry.owner !== owner) return;
    const rect = entry.el.getBoundingClientRect();
    // Keep the size it had, so the parked terminal's ResizeObserver stays quiet.
    // A 0×0 measurement (never laid out) keeps whatever size it already had.
    if (rect.width > 0 && rect.height > 0) {
      entry.el.style.width = `${rect.width}px`;
      entry.el.style.height = `${rect.height}px`;
    }
    (this.options.parkingRoot ?? defaultParkingRoot)().appendChild(entry.el);
    entry.owner = null;
    entry.props = this.options.parkedProps(entry.props);
    this.notifyEntry(id);
    // Deferred, so a claim later in the same commit (a tab moved between panes,
    // which the store already shows in its new place) can still take it.
    if (!this.options.isAlive(id)) (this.options.defer ?? queueMicrotask)(() => this.sweep());
  }

  /** Drop every parked terminal whose surface no longer exists. */
  sweep(): void {
    let changed = false;
    for (const entry of this.entries.values()) {
      if (entry.owner || this.options.isAlive(entry.id)) continue;
      this.entries.delete(entry.id);
      entry.el.remove();
      changed = true;
    }
    if (changed) this.publishIds();
  }

  /** True when a sweep could have work: lets a hot store subscription skip it. */
  hasParked(): boolean {
    for (const entry of this.entries.values()) if (!entry.owner) return true;
    return false;
  }

  private publishIds(): void {
    this.snapshot = [...this.entries.keys()];
    for (const listener of [...this.listeners]) listener();
  }

  private notifyEntry(id: string): void {
    for (const listener of [...(this.entryListeners.get(id) ?? [])]) listener();
  }
}

function shallowEqual<P>(a: P, b: P): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a) as Array<keyof P>;
  const kb = Object.keys(b) as Array<keyof P>;
  return ka.length === kb.length && ka.every((k) => Object.is(a[k], b[k]));
}
