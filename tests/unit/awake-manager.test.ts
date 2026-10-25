import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AwakeManager, type PowerBlockerDriver } from '../../src/main/awake-manager';

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
});
