/**
 * Which hidden browser surfaces an agent is driving, so they keep painting
 * while the user looks at another workspace or tab.
 *
 * Main grants a lease through `window.__wmux_keepBrowserRendering` each time an
 * agent's command reaches a web pane (src/main/browser-keep-rendering.ts has
 * the why and the measurements). BrowserPane reads it with `useKeepRendering`
 * and, while it runs, keeps a hidden webview on the visible-but-transparent
 * path instead of letting it inherit `visibility: hidden`.
 *
 * The leases live here rather than in the pane so a split-tree change that
 * remounts the pane does not drop one halfway through an agent's turn.
 */
import { useEffect, useState } from 'react';

export const KEEP_RENDERING_EVENT = 'wmux:browser-keep-rendering';

/** surface id → epoch ms at which its lease ends. */
const leases = new Map<string, number>();

/** Keep `surfaceId` painting for `ms` from `now`. A shorter grant never cuts a
 *  longer one short. */
export function grantKeepRendering(surfaceId: string, ms: number, now = Date.now()): void {
  if (!surfaceId || !(ms > 0)) return;
  for (const [id, until] of leases) {
    if (until <= now) leases.delete(id);
  }
  leases.set(surfaceId, Math.max(leases.get(surfaceId) ?? 0, now + ms));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(KEEP_RENDERING_EVENT, { detail: { surfaceId } }));
  }
}

/** Milliseconds left on `surfaceId`'s lease; 0 when no agent is driving it. */
export function keepRenderingLeft(surfaceId: string, now = Date.now()): number {
  return Math.max(0, (leases.get(surfaceId) ?? 0) - now);
}

/** True while `surfaceId` holds a lease. Re-renders when one starts and when it ends. */
export function useKeepRendering(surfaceId: string): boolean {
  const [active, setActive] = useState(() => keepRenderingLeft(surfaceId) > 0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sync = (): void => {
      clearTimeout(timer);
      const left = keepRenderingLeft(surfaceId);
      setActive(left > 0);
      if (left > 0) timer = setTimeout(sync, left);
    };
    const onGrant = (e: Event): void => {
      if ((e as CustomEvent<{ surfaceId?: string }>).detail?.surfaceId === surfaceId) sync();
    };
    sync();
    window.addEventListener(KEEP_RENDERING_EVENT, onGrant);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(KEEP_RENDERING_EVENT, onGrant);
    };
  }, [surfaceId]);
  return active;
}
