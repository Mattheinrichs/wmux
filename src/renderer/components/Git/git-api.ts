/**
 * The Git view's one door to main (#362): `window.wmux.git.view`, plus a hook
 * that runs a request and keeps its answer.
 *
 * The hook keys the request by its JSON, so a parent re-rendering with an
 * equal request object does not refire it, and it only stores an answer that
 * actually differs from the last one — a poll that finds nothing new must not
 * re-render the tree under it (#141).
 */
import { useEffect, useRef, useState } from 'react';
import type { GitViewRequest, GitViewResult } from '../../../shared/git-view';

export class GitViewError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

export async function gitView<T>(request: GitViewRequest): Promise<T> {
  const res = await window.wmux?.git?.view(request) as GitViewResult<T> | undefined;
  if (!res) throw new GitViewError('Git view unavailable', 'failed');
  if (!res.ok) throw new GitViewError(res.error, res.code);
  return res.data;
}

export interface GitQuery<T> {
  data: T | null;
  error: GitViewError | null;
  loading: boolean;
}

/**
 * Run `request` whenever it (or `refresh`) changes. `null` runs nothing and
 * clears the answer. A stale answer — one for a request that has since been
 * replaced — is dropped rather than shown. `error` set beside a non-null
 * `data` means the latest refresh failed and `data` is the previous answer.
 */
export function useGitQuery<T>(request: GitViewRequest | null, refresh: number | string = 0): GitQuery<T> {
  const key = request ? JSON.stringify(request) : '';
  const [state, setState] = useState<GitQuery<T>>({ data: null, error: null, loading: !!request });
  const lastJson = useRef('');
  const lastKey = useRef('');

  useEffect(() => {
    if (!key) {
      lastJson.current = '';
      setState({ data: null, error: null, loading: false });
      return;
    }
    const keyChanged = lastKey.current !== key;
    lastKey.current = key;
    if (keyChanged) {
      lastJson.current = '';
      setState({ data: null, error: null, loading: true });
    }
    let cancelled = false;
    gitView<T>(JSON.parse(key) as GitViewRequest).then(
      (data) => {
        if (cancelled) return;
        const json = JSON.stringify(data);
        if (json === lastJson.current) {
          setState((s) => (s.loading || s.error ? { data: s.data, error: null, loading: false } : s));
          return;
        }
        lastJson.current = json;
        setState({ data, error: null, loading: false });
      },
      (err: unknown) => {
        if (cancelled) return;
        const error = err instanceof GitViewError ? err : new GitViewError(String(err));
        // A REFRESH that fails keeps the last good answer: one git call timing
        // out (an agent mid-rebase, a slow disk) must not swap the whole view
        // for an error screen and drop what the user had selected. A new
        // request has no last answer — the key change cleared it above.
        setState((s) => ({ data: s.data, error, loading: false }));
      },
    );
    return () => { cancelled = true; };
  }, [key, refresh]);

  return state;
}

/** `abc1234` — the conventional short hash. */
export function shortHash(hash: string | null | undefined): string {
  return hash ? hash.slice(0, 7) : '';
}

/** Last path segment of a worktree path, whatever its separators. */
export function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

export function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '';
  const d = new Date(unixSeconds * 1000);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
