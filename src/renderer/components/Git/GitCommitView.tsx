/**
 * One commit (#362) — message, author, parents, the files it changed and the
 * diff of the selected one — or the files between two commits when the graph
 * has a comparison selected. A merge is shown against its FIRST parent, which
 * is what "what did this merge bring in" means on the branch it landed on.
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { GitCommitDetails, GitFileChange } from '../../../shared/git-view';
import { useT } from '../../i18n';
import { formatDate, shortHash, useGitQuery } from './git-api';
import { GitDiffView, GitFileList, StatPair, totals } from './GitParts';

interface FilesAndDiffProps {
  cwd: string;
  from: string;
  to: string;
  files: GitFileChange[];
  header: React.ReactNode;
  subtitle: string;
}

/** A file list over a diff, for any `from → to` pair of commits. */
export function FilesAndDiff({ cwd, from, to, files, header, subtitle }: Readonly<FilesAndDiffProps>) {
  const t = useT();
  const [selected, setSelected] = useState<GitFileChange | null>(files[0] ?? null);
  useEffect(() => {
    setSelected((cur) => files.find((f) => f.path === cur?.path) ?? files[0] ?? null);
  }, [files]);
  const request = useMemo(() => (selected
    ? { op: 'rangeDiff' as const, cwd, from, to, file: selected.path, ...(selected.oldPath ? { oldPath: selected.oldPath } : {}) }
    : null), [cwd, from, to, selected?.path, selected?.oldPath]);

  return (
    <div className="git-commit">
      <div className="git-commit__meta">{header}</div>
      <div className="git-split git-split--nested">
        <div className="git-list">
          <div className="git-group__header">
            <span>{t('git.filesChanged', 'Files changed')}</span>
            <span className="git-group__count">{files.length}</span>
            <StatPair {...totals(files)} />
          </div>
          {files.length === 0 && <div className="git-list__empty">{t('git.noFiles', 'No file changes')}</div>}
          <GitFileList
            files={files}
            selectedKey={selected ? `\u0000${selected.path}` : null}
            onSelect={(file) => setSelected(file)}
          />
        </div>
        <GitDiffView request={request} title={selected?.path} subtitle={subtitle} />
      </div>
    </div>
  );
}

interface CommitProps {
  cwd: string;
  hash: string;
  onSelectCommit?: (hash: string) => void;
}

export function GitCommitView({ cwd, hash, onSelectCommit }: Readonly<CommitProps>) {
  const t = useT();
  const { data, error } = useGitQuery<GitCommitDetails>({ op: 'commit', cwd, hash });
  if (error && !data) return <div className="git-empty git-empty--error">{error.message}</div>;
  if (!data) return <div className="git-empty">{t('git.loading', 'Loading…')}</div>;

  const from = data.parents[0] ?? '';
  const header = (
    <>
      <div className="git-commit__subject">{data.subject}</div>
      {data.body && <pre className="git-commit__body">{data.body}</pre>}
      <div className="git-commit__facts">
        <span className="git-hash" title={data.hash}>{shortHash(data.hash)}</span>
        <span>{data.author}</span>
        <span className="git-muted">{formatDate(data.date)}</span>
        {data.parents.length > 0 && (
          <span className="git-commit__parents">
            {data.parents.length > 1 ? t('git.parents', 'parents') : t('git.parent', 'parent')}
            {data.parents.map((p) => (
              <button key={p} type="button" className="git-link git-hash" onClick={() => onSelectCommit?.(p)}>
                {shortHash(p)}
              </button>
            ))}
          </span>
        )}
      </div>
    </>
  );
  let subtitle = t('git.rootCommit', 'root commit');
  if (data.parents.length > 1) subtitle = t('git.vsFirstParent', 'vs first parent {hash}').replace('{hash}', shortHash(from));
  else if (from) subtitle = `${shortHash(from)} → ${shortHash(data.hash)}`;
  return <FilesAndDiff cwd={cwd} from={from} to={data.hash} files={data.files} header={header} subtitle={subtitle} />;
}

interface CompareProps {
  cwd: string;
  /** Older end. */
  from: string;
  /** Newer end. */
  to: string;
}

export function GitCompareView({ cwd, from, to }: Readonly<CompareProps>) {
  const t = useT();
  const { data, error } = useGitQuery<GitFileChange[]>({ op: 'compare', cwd, from, to });
  if (error && !data) return <div className="git-empty git-empty--error">{error.message}</div>;
  if (!data) return <div className="git-empty">{t('git.loading', 'Loading…')}</div>;
  const range = `${shortHash(from)} → ${shortHash(to)}`;
  const header = (
    <div className="git-commit__subject">
      {t('git.comparing', 'Comparing {range}').replace('{range}', range)}
    </div>
  );
  return <FilesAndDiff cwd={cwd} from={from} to={to} files={data} header={header} subtitle={range} />;
}
