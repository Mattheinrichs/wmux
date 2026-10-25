import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getLocalAppDataDir } from '../shared/instance';
import { PTY_EXIT_DRAIN_MS } from './quit-sequence';

const execFileAsync = promisify(execFile);

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
  // Whitelist: [A-Za-z0-9._/-] (D8 security boundary)
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

  // The root itself is NEVER a worktree (AC-5)
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

// ─── Impure Half (#7) ────────────────────────────────────────────────────────

export interface WorktreeRecord {
  repoRoot: string;
  branch: string;
  baseBranch: string;
  baseSha: string;
  worktreePath: string;
}

export type CreateResult =
  | { ok: true; worktree: WorktreeRecord }
  | { ok: false; code: AddErrorCode; error: string };

export type RemoveOutcome =
  | 'removed' | 'has-work' | 'not-ours' | 'absent' | 'left-behind';

/**
 * Execute git with an array argv, timeout, and buffer cap (#7).
 * Uses LC_ALL=C so error messages match English patterns regardless of locale.
 */
async function execGit(
  cwd: string,
  args: string[],
  options?: { timeout?: number }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      windowsHide: true,
      timeout: options?.timeout ?? 15_000,
      maxBuffer: 5 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C', LANG: 'C' },
    });
    return {
      stdout: stdout ? stdout.toString() : '',
      stderr: stderr ? stderr.toString() : '',
    };
  } catch (err: any) {
    const stdout = err.stdout ? err.stdout.toString() : '';
    const stderr = err.stderr ? err.stderr.toString() : (err.message || '');
    const error: any = new Error(stderr || stdout || 'git command failed');
    error.code = err.code;
    error.stdout = stdout;
    error.stderr = stderr;
    throw error;
  }
}

/**
 * Resolves the root of the main repository.
 * F1: Uses `git rev-parse --path-format=absolute --git-common-dir`, then `dirname`.
 * NEVER `--show-toplevel`: inside a worktree that returns the worktree (F1),
 * nesting worktrees and hashing against the wrong repo (#7).
 */
export async function repoRootFor(dir: string): Promise<string | null> {
  if (!dir || typeof dir !== 'string') return null;
  try {
    const { stdout } = await execGit(dir, [
      'rev-parse',
      '--path-format=absolute',
      '--git-common-dir',
    ]);
    const trimmed = stdout.trim();
    if (!trimmed) return null;
    return path.resolve(path.dirname(trimmed));
  } catch {
    return null;
  }
}

export async function probeRepo(dir: string): Promise<{ repoRoot: string; currentBranch: string } | null> {
  const root = await repoRootFor(dir);
  if (!root) return null;
  try {
    const { stdout } = await execGit(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const currentBranch = stdout.trim();
    return { repoRoot: root, currentBranch: currentBranch || 'HEAD' };
  } catch {
    return { repoRoot: root, currentBranch: 'HEAD' };
  }
}

/**
 * Resolves a base commit ref to its name and SHA.
 * F5: Uses `git rev-parse --verify --quiet <ref>^{commit}` and returns `{name, sha}`.
 * Never `check-ref-format` for a base — it rejects `HEAD~3`, which is legal (F5).
 * D6: Default ref HEAD. Records commit SHA because branch names move (#7).
 */
export async function resolveBase(
  repoRoot: string,
  ref?: string
): Promise<{ name: string; sha: string } | null> {
  if (!repoRoot || typeof repoRoot !== 'string') return null;
  const targetRef = ref && ref.trim() ? ref.trim() : 'HEAD';
  try {
    const { stdout } = await execGit(repoRoot, [
      'rev-parse',
      '--verify',
      '--quiet',
      `${targetRef}^{commit}`,
    ]);
    const sha = stdout.trim();
    if (!sha) return null;
    return { name: targetRef, sha };
  } catch {
    return null;
  }
}

/**
 * Reads a worktree's `.git` file (`gitdir: <repo>/.git/worktrees/<n>`) and goes three levels up.
 * Returns null when the file is gone — which is the normal post-F2 state,
 * so callers must tolerate it (#7).
 */
export async function parentRepoOf(worktreePath: string): Promise<string | null> {
  if (!worktreePath || typeof worktreePath !== 'string') return null;
  try {
    const gitFilePath = path.join(worktreePath, '.git');
    const stat = await fs.promises.stat(gitFilePath);
    if (!stat.isFile()) return null;
    const content = await fs.promises.readFile(gitFilePath, 'utf8');
    const match = content.match(/^gitdir:\s*(.+)$/m);
    if (!match) return null;
    let gitDir = match[1].trim();
    if (!path.isAbsolute(gitDir)) {
      gitDir = path.resolve(worktreePath, gitDir);
    }
    // gitDir is <repo>/.git/worktrees/<name>; 3 levels up yields <repo>
    return path.resolve(gitDir, '..', '..', '..');
  } catch {
    return null;
  }
}

/**
 * Creates a new git worktree workspace.
 * Strict ordering (F5, D7, D8):
 * 1. isValidBranchName (whitelist check)
 * 2. repoRootFor (verify repo and find canonical root, F1)
 * 3. git check-ref-format --branch (authoritative branch name validation, D8)
 * 4. resolveBase (resolve base commit SHA, F5, D6)
 * 5. Refuse if target path exists on disk
 * 6. mkdir -p parent directory
 * 7. git worktree add -b <branch> <path> <baseSha>
 * On failure, runs `git worktree prune` and returns classified error (D7).
 */
export async function createWorktree(i: {
  repoRoot: string;
  branch: string;
  base?: string;
}): Promise<CreateResult> {
  if (!i || !isValidBranchName(i.branch)) {
    return {
      ok: false,
      code: 'invalid_branch',
      error: `Invalid branch name: ${i?.branch ?? ''}`,
    };
  }

  const root = await repoRootFor(i.repoRoot);
  if (!root) {
    return {
      ok: false,
      code: 'not_a_repo',
      error: 'Directory is not inside a git repository',
    };
  }

  try {
    await execGit(root, ['check-ref-format', '--branch', i.branch]);
  } catch {
    return {
      ok: false,
      code: 'invalid_branch',
      error: `Git rejected branch name format: ${i.branch}`,
    };
  }

  const base = await resolveBase(root, i.base);
  if (!base) {
    return {
      ok: false,
      code: 'git_failed',
      error: `Failed to resolve base ref: ${i.base ?? 'HEAD'}`,
    };
  }

  const slug = worktreeSlug(root, i.branch);
  const targetPath = path.join(worktreeRoot(), slug);

  if (fs.existsSync(targetPath)) {
    return {
      ok: false,
      code: 'exists',
      error: 'Worktree path already exists',
    };
  }

  const parentDir = path.dirname(targetPath);
  try {
    await fs.promises.mkdir(parentDir, { recursive: true });
  } catch (err: any) {
    return {
      ok: false,
      code: 'git_failed',
      error: err.message || 'Failed to create worktree directory',
    };
  }

  const args = addArgs(targetPath, i.branch, base.sha);
  try {
    await execGit(root, args);
  } catch (err: any) {
    // Prune on failure: an add can fail with metadata half landed (#7)
    try {
      await execGit(root, pruneArgs());
    } catch {
      // ignore prune failure
    }
    const stderr = err.stderr || err.message || '';
    let code = classifyAddError(stderr);
    if (code === 'branch_exists') {
      try {
        const { stdout } = await execGit(root, ['worktree', 'list', '--porcelain']);
        const needle = `branch refs/heads/${i.branch}`;
        if (stdout.split('\n').some((line) => line.trim() === needle)) {
          code = 'branch_in_use';
        }
      } catch {
        // ignore
      }
    }
    return {
      ok: false,
      code,
      error: stderr.trim() || err.message || 'git worktree add failed',
    };
  }

  return {
    ok: true,
    worktree: {
      repoRoot: root,
      branch: i.branch,
      baseBranch: base.name,
      baseSha: base.sha,
      worktreePath: targetPath,
    },
  };
}

/**
 * Removes a worktree workspace directory (#7).
 * F2: Never trusts git's exit code — git can return 0 while leaving the directory.
 * F3: Unforced by default — git checks for modified/untracked files atomically.
 * F4: Never deletes the branch.
 * D3: Single drain paid once before the single removal attempt; NO retry loop.
 */
export async function removeWorktree(
  p: string,
  o?: { force?: boolean; drainMs?: number }
): Promise<RemoveOutcome> {
  if (!isWmuxWorktreePath(worktreeRoot(), p)) {
    return 'not-ours';
  }

  p = path.resolve(p);

  // Read parent repo before git worktree remove, because git deletes .git file even if dir removal fails (F2)
  const parent = await parentRepoOf(p);

  if (!fs.existsSync(p)) {
    if (parent) {
      try {
        await execGit(parent, pruneArgs());
      } catch {
        // ignore
      }
    }
    return 'absent';
  }

  const drainMs = o?.drainMs ?? PTY_EXIT_DRAIN_MS;
  if (drainMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, drainMs));
  }

  let stderr = '';
  if (parent) {
    try {
      const res = await execGit(parent, removeArgs(p, Boolean(o?.force)));
      stderr = res.stderr;
    } catch (err: any) {
      stderr = err.stderr || err.message || '';
    }
  }

  if (!o?.force && /contains modified or untracked files/.test(stderr)) {
    return 'has-work';
  }

  if (!fs.existsSync(p)) {
    if (parent) {
      try {
        await execGit(parent, pruneArgs());
      } catch {
        // ignore
      }
    }
    return 'removed';
  }

  // F2: Directory still present after git worktree remove. Best effort fs.rm fallback.
  try {
    await fs.promises.rm(p, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch {
    // ignore
  }

  if (parent) {
    try {
      await execGit(parent, pruneArgs());
    } catch {
      // ignore
    }
  }

  return fs.existsSync(p) ? 'left-behind' : 'removed';
}

/**
 * Scans the worktree root for unmanaged directories and reconciles them (D4).
 * Walks <root>/<repo>/<branch> two levels deep, skips anything in claimed.
 * Gathers three facts, calls classifyWorktreeDir:
 * - leftover    -> fs.rm
 * - unreachable -> kept, log (#174: no paths in log)
 * - live        -> removeWorktree(p, { force: false, drainMs: 0 })
 */
export async function reconcileOrphans(
  claimed: string[]
): Promise<Array<{ outcome: RemoveOutcome | 'kept' }>> {
  const root = worktreeRoot();
  if (!fs.existsSync(root)) return [];

  const claimedSet = new Set((claimed || []).map((c) => path.resolve(c).toLowerCase()));
  const results: Array<{ outcome: RemoveOutcome | 'kept' }> = [];

  let repoDirs: string[] = [];
  try {
    repoDirs = await fs.promises.readdir(root);
  } catch {
    return [];
  }

  for (const repoDir of repoDirs) {
    const repoDirPath = path.join(root, repoDir);
    let repoStat: fs.Stats;
    try {
      repoStat = await fs.promises.stat(repoDirPath);
    } catch {
      continue;
    }
    if (!repoStat.isDirectory()) continue;

    let subEntries: string[] = [];
    try {
      subEntries = await fs.promises.readdir(repoDirPath);
    } catch {
      continue;
    }

    // Check if repoDirPath is itself an empty leftover directory (e.g. at level 1)
    if (subEntries.length === 0) {
      const resolvedRepo = path.resolve(repoDirPath);
      if (claimedSet.has(resolvedRepo.toLowerCase())) continue;
      const classification = classifyWorktreeDir({
        hasGitFile: false,
        isEmpty: true,
        gitAnswered: false,
      });
      if (classification === 'leftover') {
        try {
          await fs.promises.rm(repoDirPath, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          });
        } catch {
          // ignore
        }
        results.push({ outcome: fs.existsSync(repoDirPath) ? 'left-behind' : 'removed' });
      }
      continue;
    }

    // Two levels deep: <root>/<repo>/<branch>
    for (const branchDir of subEntries) {
      const p = path.join(repoDirPath, branchDir);
      let pStat: fs.Stats;
      try {
        pStat = await fs.promises.stat(p);
      } catch {
        continue;
      }
      if (!pStat.isDirectory()) continue;

      const resolvedP = path.resolve(p);
      if (claimedSet.has(resolvedP.toLowerCase())) {
        continue;
      }

      let hasGitFile = false;
      try {
        const gitStat = await fs.promises.stat(path.join(p, '.git'));
        hasGitFile = gitStat.isFile();
      } catch {
        hasGitFile = false;
      }

      let isEmpty = false;
      try {
        const entries = await fs.promises.readdir(p);
        isEmpty = entries.length === 0;
      } catch {
        isEmpty = false;
      }

      let gitAnswered = false;
      if (hasGitFile) {
        try {
          await execGit(p, ['rev-parse', '--git-dir']);
          gitAnswered = true;
        } catch {
          gitAnswered = false;
        }
      }

      const classification = classifyWorktreeDir({ hasGitFile, isEmpty, gitAnswered });

      if (classification === 'leftover') {
        try {
          await fs.promises.rm(p, {
            recursive: true,
            force: true,
            maxRetries: 3,
            retryDelay: 100,
          });
        } catch {
          // ignore
        }
        results.push({ outcome: fs.existsSync(p) ? 'left-behind' : 'removed' });
      } else if (classification === 'unreachable') {
        // #174: Do not include paths in main log
        console.warn('[worktree] keeping unreachable worktree directory');
        results.push({ outcome: 'kept' });
      } else {
        // live
        const outcome = await removeWorktree(p, { force: false, drainMs: 0 });
        results.push({ outcome });
      }
    }

    // Optional tidy: if repo directory is now empty, prune it
    try {
      const remaining = await fs.promises.readdir(repoDirPath);
      if (remaining.length === 0) {
        await fs.promises.rmdir(repoDirPath);
      }
    } catch {
      // ignore
    }
  }

  return results;
}
