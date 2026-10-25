import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { IconCoffee } from '../../src/renderer/components/Titlebar/icons';

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
