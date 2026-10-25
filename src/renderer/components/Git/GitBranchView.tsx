/**
 * Branch changes of the selected worktree (#362): what its HEAD has committed
 * since it forked from a chosen base.
 *
 * Measured from `merge-base(base, HEAD)` to HEAD, never from the base's tip:
 * a three-dot comparison, so commits that landed on `develop` after the agent
 * branched off do not show up as the agent's work. Uncommitted changes are
 * deliberately NOT folded in — they are the Working mode's question, and a
 * review that mixes the two cannot say what was actually committed.
 */
import React, { useState } from 'react';
import type { GitBranchChanges, GitRefs, GitWorktreeSummary } from '../../../shared/git-view';
import { useT } from '../../i18n';
import { shortHash, formatDate, useGitQuery } from './git-api';
import { FilesAndDiff, GitCommitView } from './GitCommitView';
import { StatPair, totals } from './GitParts';

interface Props {
  cwd: string;
  worktree: string;
  base: string | null;
  refs: GitRefs;
  /** The worktree's HEAD — a new commit refetches. */
  head: string;
  summary: GitWorktreeSummary | null;
  refresh: number;
  onBaseChange: (base: string) => void;
  onShowWorking: () => void;
}

export function BaseSelect({ value, refs, onChange }: Readonly<{ value: string | null; refs: GitRefs; onChange: (v: string) => void }>) {
  const t = useT();
  const known = value && !refs.local.includes(value) && !refs.remote.includes(value) ? [value] : [];
  return (
    <select className="git-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} title={t('git.baseTitle', 'Base to compare against')}>
      {!value && <option value="">{t('git.pickBase', 'Pick a base…')}</option>}
      {known.map((r) => <option key={r} value={r}>{r}</option>)}
      <optgroup label={t('git.localBranches', 'Local branches')}>
        {refs.local.map((r) => <option key={`l:${r}`} value={r}>{r}</option>)}
      </optgroup>
      {refs.remote.length > 0 && (
        <optgroup label={t('git.remoteBranches', 'Remote branches')}>
          {refs.remote.map((r) => <option key={`r:${r}`} value={r}>{r}</option>)}
        </optgroup>
      )}
    </select>
  );
}

export default function GitBranchView({ cwd, worktree, base, refs, head, summary, refresh, onBaseChange, onShowWorking }: Readonly<Props>) {
  const t = useT();
  const request = base ? { op: 'branch' as const, cwd, worktree, base } : null;
  // `head` rides along as the refresh key: a commit in that worktree changes
  // the answer, and the pane's poll is what notices it.
  const { data, error, loading } = useGitQuery<GitBranchChanges>(request, `${refresh}:${head}`);
  const [tab, setTab] = useState<'files' | 'commits'>('files');
  const [commit, setCommit] = useState<string | null>(null);
  const uncommitted = summary ? summary.staged + summary.unstaged + summary.untracked + summary.conflicted : 0;

  const bar = (
    <div className="git-subbar">
      <span className="git-muted">{t('git.base', 'Base')}</span>
      <BaseSelect value={base} refs={refs} onChange={onBaseChange} />
      {data && (
        <>
          <span className="git-muted" title={data.mergeBase ?? ''}>
            {t('git.since', 'since {hash}').replace('{hash}', shortHash(data.mergeBase) || '—')}
          </span>
          <span>{t('git.commitCount', '{count} commits').replace('{count}', String(data.commits.length))}</span>
          <StatPair {...totals(data.files)} />
        </>
      )}
      {uncommitted > 0 && (
        <button type="button" className="git-link git-subbar__note" onClick={onShowWorking}>
          {t('git.uncommittedNote', '+ {count} uncommitted (Working)').replace('{count}', String(uncommitted))}
        </button>
      )}
      <span className="git-subbar__spacer" />
      <div className="git-seg">
        <button type="button" className={tab === 'files' ? 'git-seg--on' : ''} onClick={() => { setTab('files'); setCommit(null); }}>
          {t('git.files', 'Files')}
        </button>
        <button type="button" className={tab === 'commits' ? 'git-seg--on' : ''} onClick={() => setTab('commits')}>
          {t('git.commits', 'Commits')}
        </button>
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (!base) body = <div className="git-empty">{t('git.pickBaseHint', 'Pick a base branch to review this worktree’s commits')}</div>;
  else if (error && !data) body = <div className="git-empty git-empty--error">{error.message}</div>;
  else if (loading && !data) body = <div className="git-empty">{t('git.loading', 'Loading…')}</div>;
  else if (data && tab === 'files') {
    const from = data.mergeBase ?? '';
    body = data.files.length === 0
      ? <div className="git-empty">{t('git.noBranchChanges', 'No committed changes since the base')}</div>
      : <FilesAndDiff cwd={cwd} from={from} to={data.head} files={data.files} header={null} subtitle={`${shortHash(from)}…${shortHash(data.head)}`} />;
  } else if (data) {
    body = (
      <div className="git-split">
        <div className="git-list">
          {data.commits.length === 0 && <div className="git-list__empty">{t('git.noCommits', 'No commits since the base')}</div>}
          {data.commits.map((c) => (
            <button key={c.hash} type="button" className={`git-commit-row${commit === c.hash ? ' git-file--selected' : ''}`} onClick={() => setCommit(c.hash)}>
              <span className="git-hash">{shortHash(c.hash)}</span>
              <span className="git-commit-row__subject">{c.subject}</span>
              <span className="git-muted">{c.author} · {formatDate(c.date)}</span>
            </button>
          ))}
        </div>
        {commit
          ? <GitCommitView cwd={cwd} hash={commit} onSelectCommit={setCommit} />
          : <div className="git-empty">{t('git.selectCommit', 'Select a commit')}</div>}
      </div>
    );
  }

  return (
    <div className="git-mode">
      {bar}
      {body}
    </div>
  );
}
