import type { WorktreeInspectResult, WorktreeRemoveResult } from '../../shared/types';
import type { TranslationKey } from '../i18n/core';

type T = (key: TranslationKey, fallback?: string) => string;

function fill(text: string, vars: Record<string, string | number | undefined>): string {
  return Object.entries(vars).reduce(
    (acc, [name, value]) => acc.split(`{${name}}`).join(String(value ?? '?')),
    text,
  );
}

/**
 * What the close dialog offers for a pre-flight answer (#366). The rule the
 * table encodes: the button that REMOVES the folder exists only when main said
 * the folder is clean, and Discard exists only when main recognised the
 * worktree as its own. Every other state can only close the workspace and
 * leave the folder where it is.
 */
export interface WorktreeCloseView {
  message: string;
  canKeepRemove: boolean;
  canDiscard: boolean;
  canCloseKeepFolder: boolean;
}

export function worktreeCloseView(
  inspect: WorktreeInspectResult | null,
  branch: string,
  t: T,
): WorktreeCloseView {
  if (!inspect) {
    return { message: t('worktreeClose.checking'), canKeepRemove: false, canDiscard: false, canCloseKeepFolder: false };
  }
  switch (inspect.outcome) {
    case 'clean':
      return { message: fill(t('worktreeClose.clean'), { branch }), canKeepRemove: true, canDiscard: true, canCloseKeepFolder: false };
    case 'has-work':
      return { message: fill(t('worktreeClose.hasWork'), { count: inspect.count }), canKeepRemove: false, canDiscard: true, canCloseKeepFolder: true };
    case 'absent':
      return { message: t('worktreeClose.absent'), canKeepRemove: false, canDiscard: false, canCloseKeepFolder: true };
    case 'not-ours':
      return { message: t('worktreeClose.notOurs'), canKeepRemove: false, canDiscard: false, canCloseKeepFolder: true };
    default:
      return { message: fill(t('worktreeClose.checkFailed'), { error: inspect.message }), canKeepRemove: false, canDiscard: false, canCloseKeepFolder: true };
  }
}

/** The notification a finished removal posts, or null when there is nothing to say. */
export function worktreeCloseNotice(result: WorktreeRemoveResult | null | undefined, branch: string, t: T): string {
  const outcome = result?.outcome ?? 'error';
  const error = result?.message || outcome;
  if (outcome === 'removed') {
    if (result?.branchDeleted) return fill(t('worktreeClose.result.discarded'), { branch });
    return result?.message
      ? fill(t('worktreeClose.result.branchKept'), { branch, error })
      : fill(t('worktreeClose.result.removed'), { branch });
  }
  if (outcome === 'absent') return t('worktreeClose.absent');
  if (outcome === 'has-work') return fill(t('worktreeClose.result.hasWork'), { branch, count: result?.count });
  return fill(t('worktreeClose.result.leftBehind'), { branch, error });
}

export { fill as fillWorktreeText };
