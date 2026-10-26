import { describe, it, expect } from 'vitest';
import { IPC_CHANNELS } from '../../src/shared/types';
import {
  DEFAULT_KEEP_AWAKE_PREFS,
  KEEP_AWAKE_SETTINGS_KEY,
  isKeepAwakeMode,
  parseKeepAwakePrefs,
} from '../../src/main/awake-manager';
import { DEFAULT_WORKSPACE_PREFS } from '../../src/renderer/store/settings-slice';

describe('Keep Awake settings & types', () => {
  it('defaults to smart mode with display sleep allowed (issue #363)', () => {
    expect(DEFAULT_KEEP_AWAKE_PREFS).toEqual({ mode: 'smart', preventDisplaySleep: false });
  });

  it('keeps no renderer copy of the choice: main owns it', () => {
    expect(DEFAULT_WORKSPACE_PREFS).not.toHaveProperty('keepAwakeMode');
    expect(DEFAULT_WORKSPACE_PREFS).not.toHaveProperty('preventDisplaySleep');
    expect(KEEP_AWAKE_SETTINGS_KEY).toBe('wmux-keep-awake');
  });

  it('parses persisted prefs field by field, defaulting what is malformed', () => {
    expect(parseKeepAwakePrefs(undefined)).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs('always')).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs({ mode: 'always', preventDisplaySleep: true })).toEqual({
      mode: 'always',
      preventDisplaySleep: true,
    });
    expect(parseKeepAwakePrefs({ mode: 'caffeine', preventDisplaySleep: 'yes' })).toEqual(DEFAULT_KEEP_AWAKE_PREFS);
    expect(parseKeepAwakePrefs({ mode: 'off' })).toEqual({ mode: 'off', preventDisplaySleep: false });
  });

  it('accepts exactly the three modes', () => {
    expect(['smart', 'always', 'off'].every(isKeepAwakeMode)).toBe(true);
    for (const bad of ['Smart', '', null, undefined, 1, {}]) expect(isKeepAwakeMode(bad)).toBe(false);
  });

  it('exposes the expected IPC channels in IPC_CHANNELS', () => {
    expect(IPC_CHANNELS.AWAKE_GET_STATE).toBe('awake:getState');
    expect(IPC_CHANNELS.AWAKE_SET_MODE).toBe('awake:setMode');
    expect(IPC_CHANNELS.AWAKE_SET_PREVENT_DISPLAY_SLEEP).toBe('awake:setPreventDisplaySleep');
    expect(IPC_CHANNELS.AWAKE_STATE_CHANGED).toBe('awake:stateChanged');
  });
});
