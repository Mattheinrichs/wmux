import { describe, it, expect } from 'vitest';
import { en } from '../../src/renderer/i18n/locales/en';
import { fr } from '../../src/renderer/i18n/locales/fr';

const WORKTREE_KEYS = [
  'sidebar.newWorktreeWorkspace',
  'worktreeModal.title',
  'worktreeModal.branchLabel',
  'worktreeModal.branchPlaceholder',
  'worktreeModal.baseLabel',
  'worktreeModal.basePlaceholder',
  'worktreeModal.creating',
  'worktreeModal.create',
  'worktreeModal.cancel',
  'worktreeModal.notRepo',
  'worktreeModal.error.branchExists',
  'worktreeModal.error.branchInUse',
  'worktreeModal.error.invalidBranch',
  'worktreeModal.error.notRepo',
  'worktreeModal.error.generic',
  'worktreeClose.title',
  'worktreeClose.message',
  'worktreeClose.keep',
  'worktreeClose.discard',
  'worktreeClose.cancel',
] as const;

describe('worktree workspace translations', () => {
  it('defines all worktree keys in en with non-empty values', () => {
    for (const key of WORKTREE_KEYS) {
      const val = en[key as keyof typeof en];
      expect(val, `en missing key: ${key}`).toBeDefined();
      expect(typeof val).toBe('string');
      expect((val as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('defines all worktree keys in fr with non-empty values', () => {
    for (const key of WORKTREE_KEYS) {
      const val = (fr as Record<string, string | undefined>)[key];
      expect(val, `fr missing key: ${key}`).toBeDefined();
      expect(typeof val).toBe('string');
      expect((val as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('preserves required interpolation placeholders', () => {
    expect(en['worktreeModal.error.generic' as keyof typeof en]).toContain('{error}');
    expect((fr as Record<string, string | undefined>)['worktreeModal.error.generic']).toContain('{error}');

    expect(en['worktreeClose.message' as keyof typeof en]).toContain('{branch}');
    expect((fr as Record<string, string | undefined>)['worktreeClose.message']).toContain('{branch}');
  });
});
