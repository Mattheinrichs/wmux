import { useCallback, useEffect, useState } from 'react';
import type { KeepAwakeMode, KeepAwakeState } from '../../shared/types';

/**
 * The keep-awake state as MAIN holds it (issue #363). Main persists the choice
 * and pushes every change to every window, so the titlebar menu and the
 * Settings panel — in this window or another — read one answer instead of each
 * keeping a copy that drifts from it.
 */
export const INITIAL_KEEP_AWAKE_STATE: KeepAwakeState = {
  mode: 'smart',
  isActive: false,
  preventDisplaySleep: false,
  blockerType: 'prevent-app-suspension',
};

export interface KeepAwakeControls {
  state: KeepAwakeState;
  setMode: (mode: KeepAwakeMode) => void;
  setPreventDisplaySleep: (prevent: boolean) => void;
}

export function useKeepAwake(): KeepAwakeControls {
  const [state, setState] = useState<KeepAwakeState>(INITIAL_KEEP_AWAKE_STATE);

  useEffect(() => {
    let unmounted = false;
    const accept = (st: KeepAwakeState | undefined): void => {
      if (!unmounted && st) setState(st);
    };
    const api = window.wmux?.awake;
    api?.getState?.().then(accept).catch(() => {});
    const unsubscribe = api?.onStateChange?.(accept);
    return () => {
      unmounted = true;
      unsubscribe?.();
    };
  }, []);

  const setMode = useCallback((mode: KeepAwakeMode) => {
    window.wmux?.awake?.setMode?.(mode).then((st: KeepAwakeState) => st && setState(st)).catch(() => {});
  }, []);

  const setPreventDisplaySleep = useCallback((prevent: boolean) => {
    window.wmux?.awake
      ?.setPreventDisplaySleep?.(prevent)
      .then((st: KeepAwakeState) => st && setState(st))
      .catch(() => {});
  }, []);

  return { state, setMode, setPreventDisplaySleep };
}
