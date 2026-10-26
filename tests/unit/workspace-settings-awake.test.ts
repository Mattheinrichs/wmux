// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WorkspaceSettings from '../../src/renderer/components/Settings/WorkspaceSettings';
import { useStore } from '../../src/renderer/store';
import type { KeepAwakeState } from '../../src/shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
let pushState: ((st: KeepAwakeState) => void) | null;
let setMode: ReturnType<typeof vi.fn>;

const MAIN_STATE: KeepAwakeState = {
  mode: 'always',
  isActive: true,
  preventDisplaySleep: true,
  blockerType: 'prevent-display-sleep',
};

beforeEach(async () => {
  // Rendered strings are asserted in English whatever the host locale.
  useStore.setState({ language: 'en' });
  pushState = null;
  setMode = vi.fn((mode) => Promise.resolve({ ...MAIN_STATE, mode }));
  (window as any).wmux = {
    awake: {
      getState: vi.fn(() => Promise.resolve(MAIN_STATE)),
      setMode,
      setPreventDisplaySleep: vi.fn((p) => Promise.resolve({ ...MAIN_STATE, preventDisplaySleep: p })),
      onStateChange: vi.fn((cb) => {
        pushState = cb;
        return () => {
          pushState = null;
        };
      }),
    },
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(WorkspaceSettings)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete (window as any).wmux;
});

function modeSelect(): HTMLSelectElement {
  const opt = [...host.querySelectorAll('option')].find((o) => o.value === 'always');
  return opt!.parentElement as HTMLSelectElement;
}

describe('WorkspaceSettings Keep Awake UI', () => {
  it('renders Keep computer awake options and display sleep toggle', () => {
    const text = host.textContent ?? '';
    expect(text).toContain('Keep computer awake');
    expect(text).toContain('Smart (when agents are working)');
    expect(text).toContain('Always (keep awake while wmux is open)');
    expect(text).toContain('Off (system defaults)');
    expect(text).toContain('Keep display awake');
  });

  it('says which agents Smart mode can see', () => {
    expect(host.textContent).toContain('report a working state through hooks');
    expect(host.textContent).toContain('wmux report-agent');
  });

  it('shows the state MAIN holds, and follows its pushes', () => {
    expect(modeSelect().value).toBe('always');
    act(() => pushState?.({ ...MAIN_STATE, mode: 'off', isActive: false }));
    expect(modeSelect().value).toBe('off');
  });

  it('sends a change to main instead of writing workspace prefs', async () => {
    const before = useStore.getState().workspacePrefs;
    const select = modeSelect();
    await act(async () => {
      select.value = 'smart';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(setMode).toHaveBeenCalledWith('smart');
    expect(useStore.getState().workspacePrefs).toBe(before);
  });
});
