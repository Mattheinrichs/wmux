import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AwakeManager,
  bindAwakeToAgentStates,
  countWorkingAgents,
  nextWorkingExpiryDelay,
  type PowerBlockerDriver,
  type WorkingStateLike,
} from '../../src/main/awake-manager';

describe('AwakeManager', () => {
  let driver: PowerBlockerDriver;
  let startedBlockers: Map<number, 'prevent-app-suspension' | 'prevent-display-sleep'>;
  let nextId: number;

  beforeEach(() => {
    startedBlockers = new Map();
    nextId = 100;
    driver = {
      start: vi.fn((type) => {
        const id = ++nextId;
        startedBlockers.set(id, type);
        return id;
      }),
      stop: vi.fn((id) => {
        startedBlockers.delete(id);
      }),
      isStarted: vi.fn((id) => startedBlockers.has(id)),
    };
  });

  it('initializes with smart mode, inactive, and preventDisplaySleep false', () => {
    const manager = new AwakeManager(driver);
    expect(manager.getState()).toEqual({
      mode: 'smart',
      isActive: false,
      preventDisplaySleep: false,
      blockerType: 'prevent-app-suspension',
    });
    expect(driver.start).not.toHaveBeenCalled();
  });

  it('acquires power blocker in smart mode when working agents > 0', () => {
    const manager = new AwakeManager(driver);
    manager.onWorkingAgentsCountChanged(1);

    expect(driver.start).toHaveBeenCalledWith('prevent-app-suspension');
    expect(manager.getState().isActive).toBe(true);

    // Additional working agents do not restart the blocker
    manager.onWorkingAgentsCountChanged(3);
    expect(driver.start).toHaveBeenCalledTimes(1);
    expect(manager.getState().isActive).toBe(true);
  });

  it('releases power blocker in smart mode when working agents drop to 0', () => {
    const manager = new AwakeManager(driver);
    manager.onWorkingAgentsCountChanged(1);
    expect(manager.getState().isActive).toBe(true);

    manager.onWorkingAgentsCountChanged(0);
    expect(driver.stop).toHaveBeenCalledWith(101);
    expect(manager.getState().isActive).toBe(false);
  });

  it('acquires blocker immediately in always mode regardless of working agents', () => {
    const manager = new AwakeManager(driver);
    manager.setMode('always');

    expect(driver.start).toHaveBeenCalledWith('prevent-app-suspension');
    expect(manager.getState().isActive).toBe(true);

    // Changing working count has no effect on always mode
    manager.onWorkingAgentsCountChanged(0);
    expect(manager.getState().isActive).toBe(true);
    expect(driver.stop).not.toHaveBeenCalled();
  });

  it('releases blocker when switching to off mode', () => {
    const manager = new AwakeManager(driver);
    manager.onWorkingAgentsCountChanged(1);
    expect(manager.getState().isActive).toBe(true);

    manager.setMode('off');
    expect(driver.stop).toHaveBeenCalledWith(101);
    expect(manager.getState().isActive).toBe(false);

    // Further agent activity in off mode does not start the blocker
    manager.onWorkingAgentsCountChanged(2);
    expect(driver.start).toHaveBeenCalledTimes(1);
  });

  it('upgrades blocker type when preventDisplaySleep is toggled while active', () => {
    const manager = new AwakeManager(driver);
    manager.onWorkingAgentsCountChanged(1);
    expect(driver.start).toHaveBeenCalledWith('prevent-app-suspension');

    manager.setPreventDisplaySleep(true);
    // Stops previous and starts new blocker with prevent-display-sleep
    expect(driver.stop).toHaveBeenCalledWith(101);
    expect(driver.start).toHaveBeenCalledWith('prevent-display-sleep');
    expect(manager.getState().blockerType).toBe('prevent-display-sleep');
    expect(manager.getState().isActive).toBe(true);
  });

  it('notifies listeners when state changes', () => {
    const manager = new AwakeManager(driver);
    const listener = vi.fn();
    const unsubscribe = manager.onStateChange(listener);

    manager.setMode('always');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ mode: 'always', isActive: true }));

    unsubscribe();
    manager.setMode('off');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('cleans up active blocker on dispose', () => {
    const manager = new AwakeManager(driver);
    manager.onWorkingAgentsCountChanged(1);
    expect(manager.getState().isActive).toBe(true);

    manager.dispose();
    expect(driver.stop).toHaveBeenCalledWith(101);
    expect(manager.getState().isActive).toBe(false);
  });

  it('applies the persisted mode at construction: always holds from the start', () => {
    const manager = new AwakeManager(driver, 'always');
    expect(driver.start).toHaveBeenCalledWith('prevent-app-suspension');
    expect(manager.getState().isActive).toBe(true);
  });

  it('persists mode and display flag on every change, and only on a change', () => {
    const persist = vi.fn();
    const manager = new AwakeManager(driver, 'smart', false, persist);
    manager.setMode('smart');
    expect(persist).not.toHaveBeenCalled();
    manager.setMode('off');
    expect(persist).toHaveBeenLastCalledWith({ mode: 'off', preventDisplaySleep: false });
    manager.setPreventDisplaySleep(true);
    expect(persist).toHaveBeenLastCalledWith({ mode: 'off', preventDisplaySleep: true });
    manager.onWorkingAgentsCountChanged(3);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('notifies only when the state actually changes (#141)', () => {
    const manager = new AwakeManager(driver);
    const listener = vi.fn();
    manager.onStateChange(listener);
    manager.onWorkingAgentsCountChanged(0);
    manager.onWorkingAgentsCountChanged(0);
    expect(listener).not.toHaveBeenCalled();

    manager.onWorkingAgentsCountChanged(1);
    manager.onWorkingAgentsCountChanged(2);
    manager.onWorkingAgentsCountChanged(5);
    expect(listener).toHaveBeenCalledTimes(1);

    manager.onWorkingAgentsCountChanged(0);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('swapping the blocker type while active is ONE notification', () => {
    const manager = new AwakeManager(driver);
    manager.onWorkingAgentsCountChanged(1);
    const listener = vi.fn();
    manager.onStateChange(listener);
    manager.setPreventDisplaySleep(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ isActive: true, blockerType: 'prevent-display-sleep' }));
  });

  it('a failed driver start does not read as an active blocker, and is retried', () => {
    const failing: PowerBlockerDriver = { start: vi.fn(() => null), stop: vi.fn(), isStarted: vi.fn(() => false) };
    const manager = new AwakeManager(failing);
    manager.onWorkingAgentsCountChanged(1);
    expect(manager.getState().isActive).toBe(false);
    manager.onWorkingAgentsCountChanged(2);
    expect(failing.start).toHaveBeenCalledTimes(2);
    expect(failing.stop).not.toHaveBeenCalled();
  });

  it('a driver id of 0 is a real blocker', () => {
    const zero: PowerBlockerDriver = { start: vi.fn(() => 0), stop: vi.fn(), isStarted: vi.fn(() => true) };
    const manager = new AwakeManager(zero);
    manager.onWorkingAgentsCountChanged(1);
    expect(manager.getState().isActive).toBe(true);
    manager.onWorkingAgentsCountChanged(0);
    expect(zero.stop).toHaveBeenCalledWith(0);
  });

  it('does nothing once disposed', () => {
    const persist = vi.fn();
    const manager = new AwakeManager(driver, 'smart', false, persist);
    manager.dispose();
    manager.onWorkingAgentsCountChanged(1);
    manager.setMode('always');
    manager.setPreventDisplaySleep(true);
    expect(driver.start).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(manager.getState().isActive).toBe(false);
  });
});

describe('working-agent count', () => {
  const TRUST = 15 * 60_000;

  it('counts only working states', () => {
    const states: WorkingStateLike[] = [
      { state: 'working', updatedAt: 0 },
      { state: 'blocked', updatedAt: 0 },
      { state: 'unknown', updatedAt: 0 },
      { state: 'idle', updatedAt: 0 },
      { state: 'working', updatedAt: 0 },
    ];
    expect(countWorkingAgents(states)).toBe(2);
    expect(countWorkingAgents([])).toBe(0);
  });

  it('schedules the re-check just past the OLDEST working claim', () => {
    const states: WorkingStateLike[] = [
      { state: 'working', updatedAt: 5_000 },
      { state: 'working', updatedAt: 2_000 },
      { state: 'idle', updatedAt: 0 },
    ];
    expect(nextWorkingExpiryDelay(states, 10_000, TRUST)).toBe(2_000 + TRUST + 1000 - 10_000);
    expect(nextWorkingExpiryDelay([{ state: 'idle', updatedAt: 0 }], 10_000, TRUST)).toBeNull();
    // Never a zero/negative delay that would spin.
    expect(nextWorkingExpiryDelay([{ state: 'working', updatedAt: 0 }], TRUST * 2, TRUST)).toBe(1000);
  });

  describe('bindAwakeToAgentStates', () => {
    let driver: PowerBlockerDriver;

    beforeEach(() => {
      vi.useFakeTimers();
      let nextId = 0;
      driver = { start: vi.fn(() => ++nextId), stop: vi.fn(), isStarted: vi.fn(() => true) };
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    // Mirrors agent-state.ts: `working` downgrades to `unknown` on READ, with
    // no broadcast — which is exactly why the binder needs its own timer.
    function lazyStore(trustMs: number) {
      const records: { runDepth: number; updatedAt: number }[] = [];
      const listeners = new Set<() => void>();
      const resolve = (r: { runDepth: number; updatedAt: number }): string => {
        if (r.runDepth === 0) return 'idle';
        return Date.now() - r.updatedAt > trustMs ? 'unknown' : 'working';
      };
      return {
        records,
        broadcast: () => listeners.forEach((l) => l()),
        source: {
          trustMs,
          list: () => records.map((r) => ({ state: resolve(r), updatedAt: r.updatedAt })),
          subscribe: (l: () => void) => {
            listeners.add(l);
            return () => {
              listeners.delete(l);
            };
          },
        },
      };
    }

    it('releases a stale working claim with no further broadcast', () => {
      const manager = new AwakeManager(driver);
      const store = lazyStore(TRUST);
      const unbind = bindAwakeToAgentStates(manager, store.source);

      store.records.push({ runDepth: 1, updatedAt: Date.now() });
      store.broadcast();
      expect(manager.getState().isActive).toBe(true);

      vi.advanceTimersByTime(TRUST - 1000);
      expect(manager.getState().isActive).toBe(true);

      vi.advanceTimersByTime(2_500);
      expect(manager.getState().isActive).toBe(false);
      expect(driver.stop).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      unbind();
    });

    it('a renewed claim pushes the expiry out', () => {
      const manager = new AwakeManager(driver);
      const store = lazyStore(TRUST);
      const unbind = bindAwakeToAgentStates(manager, store.source);

      store.records.push({ runDepth: 1, updatedAt: Date.now() });
      store.broadcast();
      vi.advanceTimersByTime(TRUST - 60_000);
      store.records[0].updatedAt = Date.now();
      store.broadcast();
      vi.advanceTimersByTime(120_000);
      expect(manager.getState().isActive).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      unbind();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('arms no timer while nothing is working', () => {
      const manager = new AwakeManager(driver);
      const store = lazyStore(TRUST);
      bindAwakeToAgentStates(manager, store.source);
      store.records.push({ runDepth: 0, updatedAt: Date.now() });
      store.broadcast();
      expect(vi.getTimerCount()).toBe(0);
      expect(manager.getState().isActive).toBe(false);
    });
  });
});
