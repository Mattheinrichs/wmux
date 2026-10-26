/**
 * The commit graph (#362). Worktrees share one history, so this is the
 * REPOSITORY's graph, with the selected worktree's HEAD highlighted and every
 * worktree's HEAD labelled — a detached worktree's commits sit on no branch,
 * and those are often exactly what an agent produced.
 *
 * Click a commit to see it; Ctrl/⌘-click a second one to compare the two.
 */
import React, { useMemo, useState } from 'react';
import type { GitCommit, GitGraphScope, GitRefs, GitWorktree } from '../../../shared/git-view';
import { useT } from '../../i18n';
import { baseName, formatDate, shortHash, useGitQuery } from './git-api';
import { GitCommitView, GitCompareView } from './GitCommitView';
import { layoutGraph, type GraphRow } from './git-graph-layout';

const ROW_H = 24;
const LANE_W = 14;
const PAD = 8;
const COLORS = ['#4fb3d9', '#e2c08d', '#4ec94e', '#d670d6', '#e07b52', '#8c9eff', '#e05252', '#56c9b6'];
const PAGE = 400;

function laneX(lane: number): number {
  return PAD + lane * LANE_W;
}

function segmentPath(from: number, to: number, half: 'top' | 'bottom'): string {
  const y1 = half === 'top' ? 0 : ROW_H / 2;
  const y2 = half === 'top' ? ROW_H / 2 : ROW_H;
  const x1 = laneX(from);
  const x2 = laneX(to);
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`;
  const ym = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
}

function GraphCell({ row, width, isMerge, highlight }: Readonly<{ row: GraphRow; width: number; isMerge: boolean; highlight: boolean }>) {
  const color = COLORS[row.col % COLORS.length];
  return (
    <svg className="git-graph__svg" width={PAD * 2 + Math.max(0, width - 1) * LANE_W} height={ROW_H} aria-hidden="true">
      {row.segments.map((s, i) => (
        <path key={i} d={segmentPath(s.from, s.to, s.half)} stroke={COLORS[s.color % COLORS.length]} strokeWidth={2} fill="none" />
      ))}
      <circle
        cx={laneX(row.col)} cy={ROW_H / 2} r={highlight ? 5.5 : 4}
        fill={isMerge ? 'var(--ui-bg-1)' : color} stroke={highlight ? 'var(--ui-text-primary)' : color} strokeWidth={2}
      />
    </svg>
  );
}

type RefKind = 'head' | 'local' | 'remote' | 'tag' | 'worktree' | 'worktree-selected';

/** `HEAD -> main, origin/main, tag: v1` → labelled badges. */
export function refBadges(refs: readonly string[], known: GitRefs): Array<{ label: string; kind: RefKind }> {
  const out: Array<{ label: string; kind: RefKind }> = [];
  for (const raw of refs) {
    if (raw.startsWith('HEAD -> ')) {
      out.push({ label: raw.slice('HEAD -> '.length), kind: 'head' });
    } else if (raw === 'HEAD') {
      out.push({ label: 'HEAD', kind: 'head' });
    } else if (raw.startsWith('tag: ')) {
      out.push({ label: raw.slice('tag: '.length), kind: 'tag' });
    } else if (raw.endsWith('/HEAD')) {
      // `origin/HEAD` is a pointer to a branch already labelled beside it.
    } else if (known.remote.includes(raw)) {
      out.push({ label: raw, kind: 'remote' });
    } else {
      out.push({ label: raw, kind: 'local' });
    }
  }
  return out;
}

interface Props {
  cwd: string;
  worktree: string;
  worktrees: GitWorktree[];
  refs: GitRefs;
  scope: GitGraphScope;
  /** Selected worktree's HEAD; a new commit there refetches. */
  head: string;
  refresh: number;
  onScopeChange: (scope: GitGraphScope) => void;
}

export default function GitGraphView({ cwd, worktree, worktrees, refs, scope, head, refresh, onScopeChange }: Readonly<Props>) {
  const t = useT();
  const [limit, setLimit] = useState(PAGE);
  const { data, error, loading } = useGitQuery<{ commits: GitCommit[]; more: boolean }>(
    { op: 'graph', cwd, worktree, scope, limit }, `${refresh}:${head}`,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<string | null>(null);

  const commits = data?.commits ?? [];
  const layout = useMemo(() => layoutGraph(commits), [commits]);
  const index = useMemo(() => new Map(commits.map((c, i) => [c.hash, i])), [commits]);
  const worktreeHeads = useMemo(() => {
    const m = new Map<string, GitWorktree[]>();
    for (const wt of worktrees) if (wt.head) m.set(wt.head, [...(m.get(wt.head) ?? []), wt]);
    return m;
  }, [worktrees]);
  const selectedKey = worktree.replace(/\\/g, '/').toLowerCase();

  const pick = (hash: string, additive: boolean) => {
    if (additive && selected && selected !== hash) { setCompareTo(hash); return; }
    setSelected(hash);
    setCompareTo(null);
  };

  // Older end first: the commit further down the list is the older one.
  let detail: React.ReactNode = <div className="git-empty">{t('git.selectCommitHint', 'Select a commit — Ctrl+click a second one to compare')}</div>;
  if (selected && compareTo) {
    const [older, newer] = (index.get(selected) ?? 0) > (index.get(compareTo) ?? 0) ? [selected, compareTo] : [compareTo, selected];
    detail = <GitCompareView cwd={cwd} from={older} to={newer} />;
  } else if (selected) {
    detail = <GitCommitView cwd={cwd} hash={selected} onSelectCommit={(h) => pick(h, false)} />;
  }

  return (
    <div className="git-mode">
      <div className="git-subbar">
        <span className="git-muted">{t('git.show', 'Show')}</span>
        <select className="git-select" value={scope} onChange={(e) => onScopeChange(e.target.value as GitGraphScope)}>
          <option value="all">{t('git.scope.all', 'All branches')}</option>
          <option value="local">{t('git.scope.local', 'Local branches')}</option>
          <option value="worktree">{t('git.scope.worktree', 'This worktree only')}</option>
        </select>
        {data && <span className="git-muted">{t('git.commitCount', '{count} commits').replace('{count}', String(commits.length))}</span>}
      </div>
      <div className="git-split git-split--stack">
        <div className="git-graph">
          {error && !data && <div className="git-empty git-empty--error">{error.message}</div>}
          {loading && !data && <div className="git-empty">{t('git.loading', 'Loading…')}</div>}
          {commits.map((c, i) => {
            const wts = worktreeHeads.get(c.hash) ?? [];
            const isOwnHead = c.hash === head;
            const cls = ['git-graph__row'];
            if (selected === c.hash || compareTo === c.hash) cls.push('git-graph__row--selected');
            if (isOwnHead) cls.push('git-graph__row--head');
            return (
              <button
                key={c.hash}
                type="button"
                className={cls.join(' ')}
                onClick={(e) => pick(c.hash, e.ctrlKey || e.metaKey)}
                title={`${c.hash}\n${c.author} <${c.email}>\n${formatDate(c.date)}`}
              >
                <GraphCell row={layout.rows[i]} width={layout.maxWidth} isMerge={c.parents.length > 1} highlight={isOwnHead} />
                <span className="git-graph__refs">
                  {wts.map((wt) => {
                    const own = wt.path.replace(/\\/g, '/').toLowerCase() === selectedKey;
                    return (
                      <span key={wt.path} className={`git-ref git-ref--${own ? 'worktree-selected' : 'worktree'}`} title={wt.path}>
                        ⌂ {baseName(wt.path)}
                      </span>
                    );
                  })}
                  {refBadges(c.refs, refs).map((r) => (
                    <span key={`${r.kind}:${r.label}`} className={`git-ref git-ref--${r.kind}`}>{r.label}</span>
                  ))}
                </span>
                <span className="git-graph__subject">{c.subject}</span>
                <span className="git-graph__author">{c.author}</span>
                <span className="git-graph__date">{formatDate(c.date)}</span>
                <span className="git-hash">{shortHash(c.hash)}</span>
              </button>
            );
          })}
          {data?.more && (
            <button type="button" className="git-more" onClick={() => setLimit((n) => n + PAGE)}>
              {t('git.loadMore', 'Load more')}
            </button>
          )}
        </div>
        {detail}
      </div>
    </div>
  );
}
