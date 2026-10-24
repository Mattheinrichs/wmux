import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { SplitNode } from '../../../shared/types';
import { useStore } from '../../store';
import TerminalPane, { type TerminalPaneProps } from './TerminalPane';
import { TerminalKeepAlive } from './terminal-keepalive';

/**
 * The React half of the terminal keep-alive (issue #346); the rules are in
 * ./terminal-keepalive.ts.
 *
 * `TerminalHost` is mounted once, at the App root, and portals one
 * `TerminalPane` per live terminal surface into that surface's element.
 * `KeptAliveTerminal` is what a pane renders instead of `TerminalPane`: an
 * empty slot that borrows the element for as long as it is mounted.
 *
 * One consequence of portalling from the root, which is the price of the
 * design: React events from inside the terminal bubble through the HOST's
 * ancestry, not the pane's. The pane's click-to-focus handler therefore never
 * sees a click on its own terminal, so the slot re-creates it with a native
 * listener (`onActivate`). Native DOM events are unaffected — the element is
 * physically inside the pane.
 */

function treeHasTerminal(node: SplitNode, id: string): boolean {
  if (node.type === 'branch') return treeHasTerminal(node.children[0], id) || treeHasTerminal(node.children[1], id);
  return node.surfaces.some((s) => s.id === id && s.type === 'terminal');
}

function surfaceIsAlive(id: string): boolean {
  return useStore.getState().workspaces.some((ws) => treeHasTerminal(ws.splitTree, id));
}

export const terminalKeepAlive = new TerminalKeepAlive<TerminalPaneProps>({
  isAlive: surfaceIsAlive,
  // A parked terminal is a hidden one: no WebGL context, no focus, no overlays.
  parkedProps: (props) => ({ ...props, visible: false, focused: false, showFindBar: false, copyModeActive: false }),
});

function KeptTerminal({ id }: { id: string }) {
  // The entry is mutated in place, so subscribe to the two fields that change.
  const subscribe = (listener: () => void) => terminalKeepAlive.subscribeEntry(id, listener);
  const props = useSyncExternalStore(subscribe, () => terminalKeepAlive.get(id)?.props);
  const generation = useSyncExternalStore(subscribe, () => terminalKeepAlive.get(id)?.generation ?? 0);
  const el = terminalKeepAlive.get(id)?.el;
  if (!el || !props) return null;
  return createPortal(<TerminalPane {...props} attachGeneration={generation} />, el);
}

/** Every live terminal in this window. Mount exactly once. */
export function TerminalHost() {
  const ids = useSyncExternalStore(terminalKeepAlive.subscribe, terminalKeepAlive.ids);
  // A surface closed while its terminal was parked (a zoomed workspace's other
  // panes) unmounts no slot, so nothing would release it. Most store writes are
  // metadata at PTY speed, hence the cheap guard before the tree walk.
  useEffect(() => useStore.subscribe(() => {
    if (terminalKeepAlive.hasParked()) terminalKeepAlive.sweep();
  }), []);
  return <>{ids.map((id) => <KeptTerminal key={id} id={id} />)}</>;
}

interface KeptAliveTerminalProps extends TerminalPaneProps {
  surfaceId: string;
  /** Focus this terminal's pane; see the note on event bubbling above. */
  onActivate?: () => void;
}

/** A pane's slot for its terminal surface. */
export default function KeptAliveTerminal({ onActivate, ...props }: KeptAliveTerminalProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  // Identity of THIS slot, so a stale release cannot park a terminal another
  // slot has already claimed.
  const ownerRef = useRef<object>({});
  const { surfaceId } = props;

  // Claimed once per (slot, surface) with the props of that render; every later
  // render's props go through update() below.
  const propsRef = useRef(props);
  propsRef.current = props;
  useLayoutEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const owner = ownerRef.current;
    terminalKeepAlive.claim(surfaceId, owner, slot, propsRef.current);
    return () => terminalKeepAlive.release(surfaceId, owner);
  }, [surfaceId]);

  useLayoutEffect(() => {
    terminalKeepAlive.update(surfaceId, ownerRef.current, props);
  });

  const activateRef = useRef(onActivate);
  activateRef.current = onActivate;
  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;
    const onClick = () => activateRef.current?.();
    slot.addEventListener('click', onClick);
    return () => slot.removeEventListener('click', onClick);
  }, []);

  return <div ref={slotRef} className="kept-terminal-slot" />;
}
