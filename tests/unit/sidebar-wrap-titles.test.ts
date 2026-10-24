import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SIDEBAR_PREFS } from '../../src/renderer/store/settings-slice';

// #342: a long workspace title was cut to one line with no way to read it short
// of opening the rename box. It now always carries a hover tooltip, and an
// opt-in sidebar pref lets it wrap to two lines before the ellipsis.

const ROOT = join(__dirname, '..', '..');
const ROW = readFileSync(join(ROOT, 'src/renderer/components/Sidebar/WorkspaceRow.tsx'), 'utf8');
const CSS = readFileSync(join(ROOT, 'src/renderer/styles/sidebar.css'), 'utf8');

function rule(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} rule`).toBeGreaterThanOrEqual(0);
  return CSS.slice(start, CSS.indexOf('}', start));
}

describe('workspace title wrapping (#342)', () => {
  it('is off by default, so the shipped one-line look is unchanged', () => {
    expect(DEFAULT_SIDEBAR_PREFS.wrapTitles).toBe(false);
  });

  it('shows the full name on hover in every mode', () => {
    expect(ROW).toMatch(/className=\{`workspace-row__title[^`]*`\}\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n)*\s*title=\{workspaceLabel\}/);
  });

  it('adds the wrap modifier only when the pref is on', () => {
    expect(ROW).toContain("sidebarPrefs.wrapTitles ? ' workspace-row__title--wrap' : ''");
  });

  it('keeps the base title on one line and clamps the wrapped one to two', () => {
    expect(rule('.workspace-row__title')).toContain('white-space: nowrap');
    const wrap = rule('.workspace-row__title--wrap');
    expect(wrap).toContain('white-space: normal');
    expect(wrap).toContain('-webkit-line-clamp: 2');
    expect(wrap).toContain('display: -webkit-box');
  });
});
