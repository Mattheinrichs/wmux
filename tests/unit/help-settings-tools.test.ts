// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HelpSettings from '../../src/renderer/components/Settings/HelpSettings';

// The tutorial and the developer tools left the titlebar in 2.47.0 and live in
// Settings → Help. Moving a button must not lose it: both stay one click away.

vi.mock('../../src/renderer/i18n', () => ({ useT: () => (key: string, fallback?: string) => fallback ?? key }));
vi.mock('../../src/renderer/hooks/useUpdate', () => ({
  useUpdate: () => ({ update: null, state: { phase: 'idle' }, upToDate: false, trigger: vi.fn() }),
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;
let toggleDevTools: ReturnType<typeof vi.fn>;

beforeEach(() => {
  toggleDevTools = vi.fn();
  (window as any).wmux = { system: { toggleDevTools, getVersion: () => Promise.resolve('2.47.0') } };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete (window as any).wmux;
});

function button(label: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label);
}

describe('Settings → Help tools', () => {
  it('opens the tutorial and toggles the developer tools', () => {
    const onOpenTutorial = vi.fn();
    act(() => root.render(React.createElement(HelpSettings, { onOpenTutorial })));
    act(() => button('titlebar.help')!.click());
    expect(onOpenTutorial).toHaveBeenCalledOnce();
    act(() => button('titlebar.devtools')!.click());
    expect(toggleDevTools).toHaveBeenCalledOnce();
  });

  it('hides the tutorial button when nobody can open it', () => {
    act(() => root.render(React.createElement(HelpSettings)));
    expect(button('titlebar.help')).toBeUndefined();
    expect(button('titlebar.devtools')).toBeDefined();
  });
});
