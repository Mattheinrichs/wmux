import { describe, it, expect } from 'vitest';
import { en } from '../../src/renderer/i18n/locales/en';
import { fr } from '../../src/renderer/i18n/locales/fr';

// Every worktree string, derived from English (the source of truth), so a key
// added later cannot be forgotten in French without this failing.
const WORKTREE_KEYS = Object.keys(en).filter((k) =>
  k === 'sidebar.newWorktreeWorkspace' || /^(worktree|worktreeModal|worktreeClose)\./.test(k),
);

const placeholders = (text: string): string[] => (text.match(/\{\w+\}/g) ?? []).sort();

describe('worktree workspace translations (#366)', () => {
  it('covers the dialog, badge and restore-notice strings', () => {
    for (const key of [
      'worktreeClose.hasWork', 'worktreeClose.discardWarning', 'worktreeClose.result.leftBehind',
      'worktree.badgeTitle', 'worktree.restoreMissing',
    ]) {
      expect(WORKTREE_KEYS).toContain(key);
    }
  });

  it('defines every worktree key in en and fr with non-empty values', () => {
    for (const key of WORKTREE_KEYS) {
      const enVal = (en as Record<string, string>)[key];
      const frVal = (fr as Record<string, string | undefined>)[key];
      expect(enVal.trim().length, `en ${key}`).toBeGreaterThan(0);
      expect(frVal, `fr missing key: ${key}`).toBeDefined();
      expect((frVal as string).trim().length, `fr ${key}`).toBeGreaterThan(0);
    }
  });

  it('keeps the same interpolation placeholders in en and fr', () => {
    for (const key of WORKTREE_KEYS) {
      const frVal = (fr as Record<string, string>)[key];
      expect(placeholders(frVal), key).toEqual(placeholders((en as Record<string, string>)[key]));
    }
  });

  it('says that Discard destroys uncommitted, ignored and unmerged work', () => {
    const text = en['worktreeClose.discardWarning'];
    expect(text).toMatch(/uncommitted/);
    expect(text).toMatch(/ignored/);
    expect(text).toMatch(/not merged/);
  });
});
