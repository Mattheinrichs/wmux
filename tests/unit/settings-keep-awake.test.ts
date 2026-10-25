import { describe, it, expect } from 'vitest';
import { DEFAULT_WORKSPACE_PREFS } from '../../src/renderer/store/settings-slice';
import { IPC_CHANNELS } from '../../src/shared/types';

describe('Keep Awake settings & types', () => {
  it('has DEFAULT_WORKSPACE_PREFS configured with smart mode and display sleep false', () => {
    expect(DEFAULT_WORKSPACE_PREFS.keepAwakeMode).toBe('smart');
    expect(DEFAULT_WORKSPACE_PREFS.preventDisplaySleep).toBe(false);
  });

  it('exposes the expected IPC channels in IPC_CHANNELS', () => {
    expect(IPC_CHANNELS.AWAKE_GET_STATE).toBe('awake:getState');
    expect(IPC_CHANNELS.AWAKE_SET_MODE).toBe('awake:setMode');
    expect(IPC_CHANNELS.AWAKE_SET_PREVENT_DISPLAY_SLEEP).toBe('awake:setPreventDisplaySleep');
    expect(IPC_CHANNELS.AWAKE_STATE_CHANGED).toBe('awake:stateChanged');
  });
});
