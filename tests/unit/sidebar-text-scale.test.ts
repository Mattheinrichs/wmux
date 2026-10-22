import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_SIDEBAR_PREFS,
  SIDEBAR_TEXT_SCALE_MAX,
  SIDEBAR_TEXT_SCALE_MIN,
  sidebarTextScale,
} from '../../src/renderer/store/settings-slice';

// #319: the sidebar's text size is its own setting, independent of the
// terminal font. It is a percentage in localStorage, applied as the
// `--sidebar-text-scale` custom property that every sidebar font-size
// multiplies by.

describe('sidebarTextScale', () => {
  it('keeps the shipped look by default', () => {
    expect(DEFAULT_SIDEBAR_PREFS.textScale).toBe(100);
    expect(sidebarTextScale(DEFAULT_SIDEBAR_PREFS.textScale)).toBe(1);
  });

  it('turns a percentage into a factor', () => {
    expect(sidebarTextScale(125)).toBe(1.25);
  });

  it('clamps a stored value that is out of range', () => {
    expect(sidebarTextScale(10)).toBe(SIDEBAR_TEXT_SCALE_MIN / 100);
    expect(sidebarTextScale(900)).toBe(SIDEBAR_TEXT_SCALE_MAX / 100);
  });

  it('falls back to 1 for a value that is not a number at all', () => {
    // A prefs blob saved before the field existed has no textScale; the store
    // fills it from the defaults, but a hand-edited blob can say anything.
    expect(sidebarTextScale(undefined)).toBe(1);
    expect(sidebarTextScale('120')).toBe(1);
    expect(sidebarTextScale(Number.NaN)).toBe(1);
  });
});

describe('every sidebar font size follows the scale', () => {
  // A font-size added later as a bare `Npx` would silently ignore the setting,
  // which reads as "the setting works except on that one line".
  for (const file of ['sidebar.css', 'trace.css']) {
    it(`${file} has no unscaled px font-size`, () => {
      const css = readFileSync(join(__dirname, '../../src/renderer/styles', file), 'utf8');
      const bare = css.split('\n').filter((line) => /font-size:\s*[\d.]+px\s*;/.test(line));
      expect(bare).toEqual([]);
    });
  }
});
