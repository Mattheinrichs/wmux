// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IconCoffee } from '../../src/renderer/components/Titlebar/icons';
import KeepAwakeMenu, { KEEP_AWAKE_OPTIONS } from '../../src/renderer/components/Titlebar/KeepAwakeMenu';
import { useStore } from '../../src/renderer/store';
import type { KeepAwakeState } from '../../src/shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('IconCoffee component', () => {
  it('renders SVG with viewBox and stroke attributes', () => {
    const html = renderToStaticMarkup(createElement(IconCoffee));
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-opacity="0.4"');
  });

  it('renders full stroke opacity for steam lines when active is true', () => {
    const html = renderToStaticMarkup(createElement(IconCoffee, { active: true }));
    expect(html).toContain('stroke-opacity="1"');
  });
});

describe('KeepAwakeMenu', () => {
  let root: Root;
  let host: HTMLDivElement;
  let setMode: ReturnType<typeof vi.fn>;
  const SMART: KeepAwakeState = { mode: 'smart', isActive: false, preventDisplaySleep: false, blockerType: 'prevent-app-suspension' };

  async function mount(withApi: boolean): Promise<void> {
    if (withApi) {
      setMode = vi.fn((mode) => Promise.resolve({ ...SMART, mode }));
      (window as any).wmux = {
        awake: {
          getState: vi.fn(() => Promise.resolve(SMART)),
          setMode,
          setPreventDisplaySleep: vi.fn(),
          onStateChange: vi.fn(() => () => {}),
        },
      };
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(KeepAwakeMenu)));
  }

  beforeEach(() => {
    // Rendered strings are asserted in English whatever the host locale.
    useStore.setState({ language: 'en' });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    delete (window as any).wmux;
  });

  it('renders the trigger button with no window.wmux present', async () => {
    await mount(false);
    const button = host.querySelector('button')!;
    expect(host.querySelector('.keep-awake-menu')).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Keep computer awake menu');
    expect(button.getAttribute('title')).toBe('Keep Awake: Smart (Armed — waiting for agent)');
  });

  it('declares exactly On / Smart / Off, mapped to the always / smart / off modes', () => {
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.mode)).toEqual(['always', 'smart', 'off']);
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.label)).toEqual(['On', 'Smart', 'Off']);
  });

  it('exposes the options as a radio menu that a keyboard can drive', async () => {
    await mount(true);
    act(() => host.querySelector('button')!.click());
    const items = [...host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(items.every((i) => i.tabIndex === 0)).toBe(true);

    await act(async () => {
      items[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(setMode).toHaveBeenCalledWith('always');
    expect(host.querySelector('[role="menu"]')).toBeNull();

    act(() => host.querySelector('button')!.click());
    await act(async () => {
      host.querySelectorAll<HTMLElement>('[role="menuitemradio"]')[2]
        .dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(setMode).toHaveBeenLastCalledWith('off');
  });
});
