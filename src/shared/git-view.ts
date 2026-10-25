/**
 * The project Git view (#362): worktrees, working changes, branch changes and a
 * commit graph, as one read-only surface.
 *
 * Every question goes through ONE channel (`git:view`) as a tagged request, so
 * main validates one shape in one place. The view never writes: there is no
 * request here that stages, commits, checks out or creates anything, and main
 * runs only `git` sub-commands that read (`worktree list`, `status`, `log`,
 * `diff`, `show`, `for-each-ref`, `merge-base`, `rev-parse`).
 */

export interface GitWorktree {
  /** Absolute path, in the spelling git printed (forward slashes on Windows). */
  path: string;
  /** Commit the worktree has checked out; empty for a bare entry. */
  head: string;
  /** Short branch name (`feature/x`), or null when HEAD is detached. */
  branch: string | null;
  /** The first entry `git worktree list` prints: the repository's main tree. */
  primary: boolean;
  bare: boolean;
  locked: boolean;
  /** Its directory is gone; git will prune it. Never queried for status. */
  prunable: boolean;
}

export interface GitWorktreeSummary {
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export interface GitWorktreeEntry extends GitWorktree {
  /** Null when the status could not be read (prunable, timed out, …). */
  summary: GitWorktreeSummary | null;
}

export interface GitRefs {
  local: string[];
  remote: string[];
  tags: string[];
}

export interface GitRepoInfo {
  /** Top level of the tree the view was opened on. */
  root: string;
  worktrees: GitWorktreeEntry[];
  refs: GitRefs;
  /** The base a branch review starts on when nobody picked one. */
  defaultBase: string | null;
}

export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'typechange' | 'conflicted';

export interface GitFileChange {
  path: string;
  /** Previous path of a rename/copy. */
  oldPath?: string;
  status: GitFileStatus;
  additions: number;
  deletions: number;
  binary?: boolean;
}

/** Which half of the working tree a file sits in. */
export type GitWorkingSection = 'staged' | 'unstaged' | 'untracked' | 'conflicted';

export interface GitWorkingChanges {
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: GitFileChange[];
  conflicted: GitFileChange[];
}

export interface GitCommit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** Author date, unix seconds. */
  date: number;
  subject: string;
  /** Decorations as git prints them with `%D` (`HEAD -> main, origin/main, tag: v1`). */
  refs: string[];
}

export interface GitCommitDetails extends GitCommit {
  body: string;
  committer: string;
  committerDate: number;
  files: GitFileChange[];
}

export interface GitBranchChanges {
  base: string;
  /** Commit the review is measured from — `merge-base base HEAD`. */
  mergeBase: string | null;
  head: string;
  commits: GitCommit[];
  files: GitFileChange[];
}

export type GitGraphScope = 'all' | 'local' | 'worktree';

export type GitViewRequest =
  | { op: 'repo'; cwd: string }
  | { op: 'working'; cwd: string; worktree: string }
  | { op: 'workingDiff'; cwd: string; worktree: string; file: string; section: GitWorkingSection }
  | { op: 'branch'; cwd: string; worktree: string; base: string }
  | { op: 'graph'; cwd: string; worktree: string; scope: GitGraphScope; limit: number }
  | { op: 'commit'; cwd: string; hash: string }
  /** Files between two commits (`from` empty = the commit's first parent / root). */
  | { op: 'compare'; cwd: string; from: string; to: string }
  | { op: 'rangeDiff'; cwd: string; from: string; to: string; file: string; oldPath?: string };

export type GitViewResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: 'not_repo' | 'invalid' | 'failed' };
