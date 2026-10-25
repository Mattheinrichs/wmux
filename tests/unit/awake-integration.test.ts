import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: sendMock } }],
  },
}));

import { reportAgent, clearAgentState, resetAgentState, onAgentStateBroadcast, listAgentStates } from '../../src/main/agent-state';
import { AwakeManager, type PowerBlockerDriver } from '../../src/main/awake-manager';
import type { SurfaceId } from '../../src/shared/types';

describe('Awake Integration with Agent Lifecycle', () => {
  let driver: PowerBlockerDriver;
  let started: number[];
  let stopped: number[];
  let nextId: number;
  let manager: AwakeManager;
  let unhook: () => void;

  beforeEach(() => {
    resetAgentState();
    started = [];
    stopped = [];
    nextId = 500;
    driver = {
      start: vi.fn(() => {
        const id = ++nextId;
        started.push(id);
        return id;
      }),
      stop: vi.fn((id) => {
        stopped.push(id);
      }),
      isStarted: vi.fn((id) => started.includes(id) && !stopped.includes(id)),
    };

    manager = new AwakeManager(driver, 'smart');
    unhook = onAgentStateBroadcast(() => {
      const working = listAgentStates().filter((s) => s.state === 'working').length;
      manager.onWorkingAgentsCountChanged(working);
    });
  });

  afterEach(() => {
    unhook();
    manager.dispose();
    resetAgentState();
  });

  it('keeps Windows awake when an agent starts working, and releases when idle', () => {
    const surf = 'surf-test-1' as SurfaceId;

    // Agent starts working
    reportAgent(surf, { runDepth: 1 });
    expect(manager.getState().isActive).toBe(true);
    expect(driver.start).toHaveBeenCalledTimes(1);

    // Agent finishes turn -> runDepth 0
    reportAgent(surf, { runDepth: 0 });
    expect(manager.getState().isActive).toBe(false);
    expect(driver.stop).toHaveBeenCalledWith(501);
  });

  it('releases sleep blocker when agent is blocked waiting on human input', () => {
    const surf = 'surf-test-2' as SurfaceId;

    // Agent is running a tool
    reportAgent(surf, { runDepth: 1 });
    expect(manager.getState().isActive).toBe(true);

    // Permission prompt pops up -> awaitingHuman: true
    reportAgent(surf, { awaitingHuman: true, reason: 'Execute bash command' });
    expect(manager.getState().isActive).toBe(false);
    expect(driver.stop).toHaveBeenCalledWith(501);

    // Human approves -> awaitingHuman: false, runDepth: 1
    reportAgent(surf, { awaitingHuman: false, runDepth: 1 });
    expect(manager.getState().isActive).toBe(true);
    expect(driver.start).toHaveBeenCalledTimes(2);
  });

  it('releases sleep blocker when PTY exits / agent is cleared', () => {
    const surf = 'surf-test-3' as SurfaceId;

    reportAgent(surf, { runDepth: 1 });
    expect(manager.getState().isActive).toBe(true);

    clearAgentState(surf);
    expect(manager.getState().isActive).toBe(false);
  });
});
