import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';

/**
 * Confirmation dialog when closing a Git Worktree workspace (#7).
 * Options:
 * - Keep branch (default / Enter): removes worktree directory cleanly with { force: false },
 *   leaves branch in git repo, closes workspace in wmux.
 * - Discard: removes worktree directory with { force: true }, deletes branch in git repo,
 *   closes workspace in wmux.
 * - Cancel (Escape / overlay click): dismisses dialog, closes nothing.
 */
export default function ConfirmWorktreeCloseDialog() {
  const t = useT();
  const pendingWs = useStore((s) => s.pendingCloseWorktree);
  const cancelCloseWorktree = useStore((s) => s.cancelCloseWorktree);
  const closeWorkspace = useStore((s) => s.closeWorkspace);
  const keepBtnRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);

  const open = pendingWs !== null && pendingWs.worktree !== undefined;

  useEffect(() => {
    if (open) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => keepBtnRef.current?.focus());
      } else {
        keepBtnRef.current?.focus();
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        cancelCloseWorktree();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy, cancelCloseWorktree]);

  if (!open || !pendingWs || !pendingWs.worktree) return null;

  const wt = pendingWs.worktree;

  const handleKeep = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.wmux?.worktree?.remove(wt.worktreePath, { force: false });
    } finally {
      closeWorkspace(pendingWs.id);
      cancelCloseWorktree();
      setBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await window.wmux?.worktree?.remove(wt.worktreePath, { force: true });
      await window.wmux?.worktree?.deleteBranch(wt.repoRoot, wt.branch);
    } finally {
      closeWorkspace(pendingWs.id);
      cancelCloseWorktree();
      setBusy(false);
    }
  };

  const handleCancel = () => {
    if (busy) return;
    cancelCloseWorktree();
  };

  return (
    <div className="confirm-dialog__overlay" onClick={handleCancel}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-worktree-close-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-dialog__title" id="confirm-worktree-close-title">
          {t('worktreeClose.title', 'Close worktree workspace')}
        </div>
        <div className="confirm-dialog__message">
          {t('worktreeClose.message', "This workspace is backed by git worktree '{branch}'.").replace(
            '{branch}',
            wt.branch,
          )}
        </div>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn"
            onClick={handleCancel}
            disabled={busy}
          >
            {t('worktreeClose.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--danger"
            onClick={handleDiscard}
            disabled={busy}
          >
            {t('worktreeClose.discard', 'Discard')}
          </button>
          <button
            ref={keepBtnRef}
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--primary"
            onClick={handleKeep}
            disabled={busy}
          >
            {t('worktreeClose.keep', 'Keep branch')}
          </button>
        </div>
      </div>
    </div>
  );
}
