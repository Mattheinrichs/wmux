import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { useT } from '../i18n';
import type { SurfaceId, WorktreeCloseMode, WorktreeInspectResult } from '../../shared/types';
import { fillWorktreeText, worktreeCloseNotice, worktreeCloseView } from './worktree-close';

/**
 * Close dialog for a Git worktree workspace (#366).
 *
 * The folder is the user's work, so the order of operations is the design:
 *
 * 1. While the workspace is still open, main INSPECTS the folder (read-only).
 *    Anything modified, untracked or ignored, or anything main does not
 *    recognise as its own, means "remove" is not offered at all — the user can
 *    cancel, close and leave the folder on disk, or knowingly Discard.
 * 2. Only then is the workspace closed: its shells hold the folder as their
 *    cwd, and Windows will not delete a directory a process is standing in.
 * 3. Main removes (re-checking for work after the shells are gone), and the
 *    OUTCOME is posted as a notification — a folder left behind is said, not
 *    swallowed.
 *
 * Every other way of closing a worktree workspace (the CLI, closing its last
 * tab) skips this dialog and simply leaves the folder on disk.
 */
export default function ConfirmWorktreeCloseDialog() {
  const t = useT();
  const pendingWs = useStore((s) => s.pendingCloseWorktree);
  const cancelCloseWorktree = useStore((s) => s.cancelCloseWorktree);
  const closeWorkspace = useStore((s) => s.closeWorkspace);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [inspect, setInspect] = useState<WorktreeInspectResult | null>(null);

  const wt = pendingWs?.worktree;
  const worktreePath = wt?.worktreePath;

  useEffect(() => {
    setInspect(null);
    if (!worktreePath) return;
    let live = true;
    Promise.resolve(window.wmux?.worktree?.inspect?.(worktreePath))
      .then((res: WorktreeInspectResult | undefined) => {
        if (live) setInspect(res ?? { outcome: 'error', message: 'unavailable' });
      })
      .catch((err: unknown) => {
        if (live) setInspect({ outcome: 'error', message: (err as Error)?.message });
      });
    return () => { live = false; };
  }, [worktreePath]);

  useEffect(() => {
    if (inspect) primaryRef.current?.focus();
  }, [inspect]);

  useEffect(() => {
    if (!worktreePath) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) {
        e.stopPropagation();
        cancelCloseWorktree();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [worktreePath, busy, cancelCloseWorktree]);

  if (!pendingWs || !wt) return null;

  const view = worktreeCloseView(inspect, wt.branch, t);

  const notify = (text: string) => {
    const store = useStore.getState();
    store.addNotification({
      surfaceId: '' as SurfaceId,
      workspaceId: store.activeWorkspaceId ?? pendingWs.id,
      text,
    });
  };

  const closeOnly = () => {
    if (busy) return;
    closeWorkspace(pendingWs.id);
    cancelCloseWorktree();
  };

  const closeAndRemove = async (mode: WorktreeCloseMode) => {
    if (busy) return;
    setBusy(true);
    closeWorkspace(pendingWs.id);
    cancelCloseWorktree();
    try {
      const result = await window.wmux?.worktree?.remove?.(wt.worktreePath, mode);
      notify(worktreeCloseNotice(result, wt.branch, t));
    } catch (err) {
      notify(worktreeCloseNotice({ outcome: 'error', message: (err as Error)?.message }, wt.branch, t));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    if (!busy) cancelCloseWorktree();
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
          {fillWorktreeText(t('worktreeClose.message'), { branch: wt.branch })}
        </div>
        <div className="confirm-dialog__message" role="status">{view.message}</div>
        {view.canDiscard && (
          <div className="confirm-dialog__message confirm-dialog__message--warning">
            {fillWorktreeText(t('worktreeClose.discardWarning'), { branch: wt.branch })}
          </div>
        )}
        <div className="confirm-dialog__actions">
          <button type="button" className="confirm-dialog__btn" onClick={handleCancel} disabled={busy}>
            {t('worktreeClose.cancel', 'Cancel')}
          </button>
          {view.canDiscard && (
            <button
              type="button"
              className="confirm-dialog__btn confirm-dialog__btn--danger"
              onClick={() => { void closeAndRemove('discard'); }}
              disabled={busy}
            >
              {t('worktreeClose.discard', 'Discard')}
            </button>
          )}
          {view.canCloseKeepFolder && (
            <button
              ref={view.canKeepRemove ? undefined : primaryRef}
              type="button"
              className="confirm-dialog__btn confirm-dialog__btn--primary"
              onClick={closeOnly}
              disabled={busy}
            >
              {t('worktreeClose.closeKeepFolder', 'Close, keep folder')}
            </button>
          )}
          {view.canKeepRemove && (
            <button
              ref={primaryRef}
              type="button"
              className="confirm-dialog__btn confirm-dialog__btn--primary"
              onClick={() => { void closeAndRemove('keep'); }}
              disabled={busy}
            >
              {t('worktreeClose.keep', 'Keep branch')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
