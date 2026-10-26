import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { IconCoffee } from '../../src/renderer/components/Titlebar/icons';
import KeepAwakeMenu, { KEEP_AWAKE_OPTIONS } from '../../src/renderer/components/Titlebar/KeepAwakeMenu';

describe('IconCoffee component', () => {
  it('renders SVG with viewBox and stroke attributes', () => {
    const html = renderToStaticMarkup(React.createElement(IconCoffee));
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('stroke-opacity="0.4"');
  });

  it('renders full stroke opacity for steam lines when active is true', () => {
    const html = renderToStaticMarkup(React.createElement(IconCoffee, { active: true }));
    expect(html).toContain('stroke-opacity="1"');
  });
});

describe('KeepAwakeMenu', () => {
  it('renders the trigger button with no window.wmux present', () => {
    const html = renderToStaticMarkup(React.createElement(KeepAwakeMenu));
    expect(html).toContain('keep-awake-menu');
    expect(html).toContain('aria-label="Keep computer awake menu"');
  });

  it('declares exactly On / Smart / Off, mapped to the always / smart / off modes', () => {
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.mode)).toEqual(['always', 'smart', 'off']);
    expect(KEEP_AWAKE_OPTIONS.map((o) => o.label)).toEqual(['On', 'Smart', 'Off']);
  });
});
