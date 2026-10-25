import path from 'path';
import crypto from 'crypto';
import { getLocalAppDataDir } from '../shared/instance';

/** 24 each, measured: root is 37 chars and this repo's deepest node_modules
 *  path is 116, against a 260 limit with core.longpaths unset (D5). */
export const SLUG_MAX = 24;

export function isValidBranchName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 200) return false;
  if (name.startsWith('-')) return false;
  if (name.includes('..')) return false;
  if (name.endsWith('.lock')) return false;
  if (name.startsWith('.') || name.startsWith('/')) return false;
  if (name.endsWith('/')) return false;
  // Whitelist: [A-Za-z0-9._/-]
  const validRegex = /^[A-Za-z0-9._/-]+$/;
  return validRegex.test(name);
}

export function slugSegment(text: string, max: number = SLUG_MAX): string {
  if (!text || typeof text !== 'string') return '';
  // Replace any non-alphanumeric/non-dash characters with '-'
  let slug = text.replace(/[^A-Za-z0-9-]/g, '-');
  // Collapse consecutive dashes
  slug = slug.replace(/-+/g, '-');
  // Trim leading/trailing dashes
  slug = slug.replace(/^-+|-+$/g, '');
  if (slug.length > max) {
    slug = slug.slice(0, max);
    // Trim trailing dash if truncation created one
    slug = slug.replace(/-+$/, '');
  }
  return slug;
}

export function worktreeRoot(): string {
  return path.join(getLocalAppDataDir(), 'wt');
}

export function worktreeSlug(repoRoot: string, branch: string): string {
  const repoBase = path.basename(repoRoot);
  const repoSlug = slugSegment(repoBase);
  const branchSlug = slugSegment(branch);

  const hashInput = (repoRoot || '').toLowerCase() + '\0' + (branch || '');
  const sha = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 8);

  return `${repoSlug}/${branchSlug}-${sha}`;
}

export function isWmuxWorktreePath(root: string, candidate: string): boolean {
  if (!root || !candidate) return false;
  const normalizedRoot = path.resolve(root).toLowerCase();
  const normalizedCandidate = path.resolve(candidate).toLowerCase();

  // The root itself is NEVER a worktree
  if (normalizedCandidate === normalizedRoot) {
    return false;
  }

  // Must be strictly inside root with path separator
  const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  return normalizedCandidate.startsWith(prefix);
}

export function addArgs(worktreePath: string, branch: string, baseSha: string): string[] {
  return ['worktree', 'add', '-b', branch, worktreePath, baseSha];
}

export function removeArgs(worktreePath: string, force: boolean): string[] {
  return force ? ['worktree', 'remove', '--force', worktreePath] : ['worktree', 'remove', worktreePath];
}

export function pruneArgs(): string[] {
  return ['worktree', 'prune'];
}

export type AddErrorCode =
  | 'invalid_branch'
  | 'not_a_repo'
  | 'branch_exists'
  | 'branch_in_use'
  | 'exists'
  | 'git_failed';

export function classifyAddError(stderr: string): AddErrorCode {
  if (!stderr) return 'git_failed';
  const lower = stderr.toLowerCase();
  if (lower.includes('is already used by worktree at')) {
    return 'branch_in_use';
  }
  if (lower.includes('a branch named') || lower.includes('already exists')) {
    return 'branch_exists';
  }
  return 'git_failed';
}

export function classifyWorktreeDir(facts: {
  hasGitFile: boolean;
  isEmpty: boolean;
  gitAnswered: boolean;
}): 'leftover' | 'unreachable' | 'live' {
  if (!facts.hasGitFile && facts.isEmpty) {
    return 'leftover';
  }
  if (!facts.gitAnswered) {
    return 'unreachable';
  }
  if (!facts.hasGitFile && !facts.isEmpty) {
    return 'unreachable';
  }
  return 'live';
}
