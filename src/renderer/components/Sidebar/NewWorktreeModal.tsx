import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useT } from '../../i18n';

export interface NewWorktreeModalProps {
  onClose: () => void;
  cwd?: string;
}

export function isValidBranchName(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.length === 0 || name.length > 200) return false;
  if (name.startsWith('-')) return false;
  if (name.includes('..')) return false;
  if (name.endsWith('.lock')) return false;
  if (name.startsWith('.') || name.startsWith('/')) return false;
  if (name.endsWith('/')) return false;
  const validRegex = /^[A-Za-z0-9._/-]+$/;
  return validRegex.test(name);
}

export default function NewWorktreeModal({ onClose, cwd }: NewWorktreeModalProps) {
  const t = useT();
  const activeWorkspace = useStore((s) => s.workspaces.find((w) => w.id === s.activeWorkspaceId));
  const targetCwd = cwd ?? activeWorkspace?.cwd ?? '';

  const [isRepo, setIsRepo] = useState<boolean | null>(null);
  const [repoRoot, setRepoRoot] = useState<string>('');
  const [branch, setBranch] = useState<string>('');
  const [base, setBase] = useState<string>('');
  const [touched, setTouched] = useState<boolean>(false);
  const [creating, setCreating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const branchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const probe = window.wmux?.worktree?.probe;
    if (!probe || !targetCwd) {
      setIsRepo(false);
      return;
    }
    probe(targetCwd)
      .then((res: { repoRoot: string; currentBranch: string } | null) => {
        if (cancelled) return;
        if (!res || !res.repoRoot) {
          setIsRepo(false);
        } else {
          setIsRepo(true);
          setRepoRoot(res.repoRoot);
          setBase(res.currentBranch || 'HEAD');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setIsRepo(false);
      });
    return () => {
      cancelled = true;
    };
  }, [targetCwd]);

  useEffect(() => {
    if (isRepo) {
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(() => {
          branchInputRef.current?.focus();
        });
      } else {
        branchInputRef.current?.focus();
      }
    }
  }, [isRepo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const isBranchValid = isValidBranchName(branch);
  const showBranchError = (touched || branch.length > 0) && !isBranchValid;
  const canSubmit = isRepo === true && isBranchValid && !creating;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setCreating(true);
    setErrorMessage('');
    try {
      const res = await window.wmux?.worktree?.create(repoRoot, branch.trim(), base.trim() || undefined);
      if (res?.ok && res.worktree) {
        const createWorkspace = useStore.getState().createWorkspace;
        const selectWorkspace = useStore.getState().selectWorkspace;
        const newId = createWorkspace(
          {
            cwd: res.worktree.worktreePath,
            worktree: res.worktree,
            title: res.worktree.branch,
          },
          t,
        );
        selectWorkspace(newId);
        onClose();
        return;
      }
      const code = res?.code || res?.error;
      let msg = '';
      if (code === 'branch_exists') {
        msg = t('worktreeModal.error.branchExists', 'A branch with this name already exists');
      } else if (code === 'branch_in_use') {
        msg = t('worktreeModal.error.branchInUse', 'This branch is already checked out in another worktree');
      } else if (code === 'invalid_branch') {
        msg = t('worktreeModal.error.invalidBranch', 'Invalid branch name');
      } else if (code === 'not_a_repo') {
        msg = t('worktreeModal.error.notRepo', 'Not a Git repository');
      } else {
        const err = res?.error || res?.code || 'unknown';
        msg = t('worktreeModal.error.generic', 'Failed to create worktree: {error}').replace('{error}', err);
      }
      setErrorMessage(msg);
    } catch (err: any) {
      const errStr = err?.message || String(err);
      setErrorMessage(t('worktreeModal.error.generic', 'Failed to create worktree: {error}').replace('{error}', errStr));
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="confirm-dialog__overlay" onClick={onClose}>
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="worktree-modal-title"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (canSubmit) {
              handleSubmit();
            }
          }
        }}
      >
        <div className="confirm-dialog__title" id="worktree-modal-title">
          {t('worktreeModal.title', 'New worktree workspace')}
        </div>

        {isRepo === false && (
          <div className="worktree-modal__warning">
            {t('worktreeModal.notRepo', 'Current folder is not a Git repository')}
          </div>
        )}

        <label className="confirm-dialog__message" htmlFor="worktree-branch-input">
          {t('worktreeModal.branchLabel', 'Branch name')}
        </label>
        <input
          ref={branchInputRef}
          id="worktree-branch-input"
          className="worktree-modal__input"
          value={branch}
          disabled={isRepo !== true || creating}
          placeholder={t('worktreeModal.branchPlaceholder', 'feature/my-change')}
          spellCheck={false}
          maxLength={200}
          onBlur={() => setTouched(true)}
          onChange={(e) => {
            setBranch(e.target.value);
            setErrorMessage('');
          }}
        />
        {showBranchError && (
          <div className="worktree-modal__error">
            {t('worktreeModal.error.invalidBranch', 'Invalid branch name')}
          </div>
        )}

        <label className="confirm-dialog__message" htmlFor="worktree-base-input">
          {t('worktreeModal.baseLabel', 'Base branch or commit')}
        </label>
        <input
          id="worktree-base-input"
          className="worktree-modal__input"
          value={base}
          disabled={isRepo !== true || creating}
          placeholder={t('worktreeModal.basePlaceholder', 'HEAD')}
          spellCheck={false}
          maxLength={200}
          onChange={(e) => {
            setBase(e.target.value);
            setErrorMessage('');
          }}
        />

        {errorMessage && (
          <div className="worktree-modal__error">
            {errorMessage}
          </div>
        )}

        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="confirm-dialog__btn"
            onClick={onClose}
            disabled={creating}
          >
            {t('worktreeModal.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            className="confirm-dialog__btn confirm-dialog__btn--primary"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {creating
              ? t('worktreeModal.creating', 'Creating worktree…')
              : t('worktreeModal.create', 'Create workspace')}
          </button>
        </div>
      </div>
    </div>
  );
}
