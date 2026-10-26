import type { WorktreeMetadata } from '../../../shared/types';

/** One comparable spelling of a Windows path: Git Bash `/c/` and WSL
 *  `/mnt/c/` folded to `c:\`, separators unified, case folded, no trailing
 *  separator. Comparison only — never handed back to the filesystem. */
function comparable(p: string): string {
  let s = p.replace(/\//g, '\\');
  const posixDrive = /^\\(?:mnt\\)?([a-z])(\\|$)/i.exec(s);
  if (posixDrive) s = `${posixDrive[1]}:\\${s.slice(posixDrive[0].length)}`;
  s = s.toLowerCase();
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}

/**
 * The base commit a Diff surface compares against (#366): the worktree
 * workspace's `baseSha`, but ONLY when the diff's folder is inside that
 * worktree. A diff pinned to another repository (an explorer-opened tab in a
 * different checkout) must keep comparing against its own HEAD — a SHA from
 * another repository would make every file look changed, or nothing at all.
 */
export function worktreeDiffBase(cwd: string | undefined, worktree: WorktreeMetadata | undefined): string | undefined {
  if (!cwd || !worktree?.worktreePath || !worktree.baseSha) return undefined;
  const dir = comparable(cwd);
  const root = comparable(worktree.worktreePath);
  return dir === root || dir.startsWith(`${root}\\`) ? worktree.baseSha : undefined;
}
