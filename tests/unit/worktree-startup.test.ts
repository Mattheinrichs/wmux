import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as gitWorktree from '../../src/main/git-worktree';

const MAIN_DIR = join(__dirname, '../../src/main');
const INDEX = readFileSync(join(MAIN_DIR, 'index.ts'), 'utf8');

/**
 * #366: the first version swept "unclaimed clean" worktrees at startup. Every
 * update restored from an Auto-backup that had dropped the `worktree` binding,
 * and session.json is only written every 30 s, so the sweep removed live
 * checkouts. There must be no startup removal of any kind.
 */
describe('worktree startup: no sweep', () => {
  it('index.ts runs no worktree reconciliation or removal at startup', () => {
    expect(INDEX).not.toMatch(/reconcileOrphans/);
    expect(INDEX).not.toMatch(/removeWorktree/);
  });

  it('git-worktree.ts exports no sweep entry point', () => {
    expect((gitWorktree as Record<string, unknown>).reconcileOrphans).toBeUndefined();
  });

  it('restore only verifies (never removes) worktree bindings', () => {
    expect(INDEX).toMatch(/verifyRestoredWorktrees\(savedWindows, \{ showNotice: deliverPaneNotice \}\)/);
  });
});
