/**
 * Working changes of the selected worktree (#362): staged, unstaged,
 * untracked and conflicted files in four groups, each file's diff beside them.
 * A file staged AND modified again appears in both groups, because those are
 * two different diffs (index vs HEAD, worktree vs index).
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { GitFileChange, GitWorkingChanges, GitWorkingSection } from '../../../shared/git-view';
import { useT } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import { useGitQuery } from './git-api';
import { GitDiffView, GitFileList, StatPair, fileKey, totals } from './GitParts';

const SECTIONS: Array<{ id: GitWorkingSection; key: TranslationKey; fallback: string }> = [
  { id: 'conflicted', key: 'git.section.conflicted', fallback: 'Conflicts' },
  { id: 'staged', key: 'git.section.staged', fallback: 'Staged' },
  { id: 'unstaged', key: 'git.section.unstaged', fallback: 'Changes' },
  { id: 'untracked', key: 'git.section.untracked', fallback: 'Untracked' },
];

interface Props {
  cwd: string;
  worktree: string;
  /** Bumped by the pane's poll and by agent hooks. */
  refresh: number;
}

interface Selection { section: GitWorkingSection; file: GitFileChange; key: string }

function firstFile(changes: GitWorkingChanges): Selection | null {
  for (const s of SECTIONS) {
    const file = changes[s.id][0];
    if (file) return { section: s.id, file, key: fileKey(file, s.id) };
  }
  return null;
}

function stillPresent(changes: GitWorkingChanges, sel: Selection | null): Selection | null {
  if (!sel) return null;
  const file = changes[sel.section].find((f) => f.path === sel.file.path);
  return file ? { ...sel, file } : null;
}

export default function GitWorkingView({ cwd, worktree, refresh }: Readonly<Props>) {
  const t = useT();
  const { data, error, loading } = useGitQuery<GitWorkingChanges>({ op: 'working', cwd, worktree }, refresh);
  const [selection, setSelection] = useState<Selection | null>(null);

  // Keep the selected file across polls; fall back to the first file when it
  // disappears (committed, reverted) rather than to an empty diff.
  useEffect(() => {
    if (!data) return;
    setSelection((sel) => stillPresent(data, sel) ?? firstFile(data));
  }, [data]);
  useEffect(() => { setSelection(null); }, [worktree]);

  const count = data ? SECTIONS.reduce((n, s) => n + data[s.id].length, 0) : 0;
  const diffRequest = useMemo(() => (selection
    ? { op: 'workingDiff' as const, cwd, worktree, file: selection.file.path, section: selection.section }
    : null), [cwd, worktree, selection?.file.path, selection?.section]);

  if (error && !data) return <div className="git-empty git-empty--error">{error.message}</div>;
  if (loading && !data) return <div className="git-empty">{t('git.loading', 'Loading…')}</div>;

  return (
    <div className="git-split">
      <div className="git-list">
        {count === 0 && <div className="git-list__empty">{t('git.cleanTree', 'No uncommitted changes')}</div>}
        {data && SECTIONS.map((s) => data[s.id].length > 0 && (
          <div key={s.id} className="git-group">
            <div className="git-group__header">
              <span>{t(s.key, s.fallback)}</span>
              <span className="git-group__count">{data[s.id].length}</span>
              <StatPair {...totals(data[s.id])} />
            </div>
            <GitFileList
              files={data[s.id]}
              group={s.id}
              selectedKey={selection?.key ?? null}
              onSelect={(file, key) => setSelection({ section: s.id, file, key })}
            />
          </div>
        ))}
      </div>
      <GitDiffView
        request={diffRequest}
        refresh={refresh}
        title={selection?.file.path}
        subtitle={selection ? sectionSubtitle(selection.section, t) : undefined}
      />
    </div>
  );
}

function sectionSubtitle(section: GitWorkingSection, t: (k: TranslationKey, f?: string) => string): string {
  switch (section) {
    case 'staged': return t('git.vsHead', 'index vs HEAD');
    case 'untracked': return t('git.newFile', 'new file');
    default: return t('git.vsIndex', 'working tree vs index');
  }
}
