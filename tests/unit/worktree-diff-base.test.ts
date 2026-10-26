import { describe, it, expect } from 'vitest';
import { worktreeDiffBase } from '../../src/renderer/components/Diff/diff-base';
import type { WorktreeMetadata } from '../../src/shared/types';

const wt: WorktreeMetadata = {
  repoRoot: 'C:\\code\\app',
  branch: 'feat/x',
  baseBranch: 'main',
  baseSha: 'a'.repeat(40),
  worktreePath: 'C:\\Users\\u\\AppData\\Local\\wmux\\wt\\app\\feat-x-12345678',
};

describe('worktreeDiffBase (#366): the base applies only inside the worktree', () => {
  it('applies to the worktree folder itself and anything under it, any spelling', () => {
    expect(worktreeDiffBase(wt.worktreePath, wt)).toBe(wt.baseSha);
    expect(worktreeDiffBase(`${wt.worktreePath}\\src`, wt)).toBe(wt.baseSha);
    expect(worktreeDiffBase(wt.worktreePath.toLowerCase(), wt)).toBe(wt.baseSha);
    expect(worktreeDiffBase('/c/Users/u/AppData/Local/wmux/wt/app/feat-x-12345678/src', wt)).toBe(wt.baseSha);
    expect(worktreeDiffBase(`${wt.worktreePath}\\`, wt)).toBe(wt.baseSha);
  });

  it('does not apply to an explorer-pinned diff of another repository', () => {
    expect(worktreeDiffBase('C:\\code\\other-repo', wt)).toBeUndefined();
    expect(worktreeDiffBase(wt.repoRoot, wt)).toBeUndefined();
    // A sibling whose name merely starts with the worktree's.
    expect(worktreeDiffBase(`${wt.worktreePath}-other`, wt)).toBeUndefined();
  });

  it('is undefined without a worktree or a cwd', () => {
    expect(worktreeDiffBase(wt.worktreePath, undefined)).toBeUndefined();
    expect(worktreeDiffBase(undefined, wt)).toBeUndefined();
  });
});
