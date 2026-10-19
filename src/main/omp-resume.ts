// ─── Omp resume, main side ───────────────────────────────────────────────────
//
// The fourth provider beside Claude (#186), Codex (#261), and OpenCode (#290).
// The handle comes from wmux's own omp extension, which sees session events
// and calls `wmux report-session <path> --provider omp`; restore launches
// `omp --resume <path>`. Same shape as opencode-resume.ts / codex-resume.ts
// on purpose — one stamp per provider, mutually exclusive through
// agent-session-persistence.ts.

import fs from 'node:fs';
import type { SurfaceId } from '../shared/types';
import { mapSurfaces } from './claude-resume';

/**
 * An omp session identifier must be a real absolute path to a .jsonl session transcript.
 * Bare session IDs are deliberately not accepted to avoid cross-profile / cross-directory
 * mis-matching and to guarantee exact session restore.
 *
 * Legitimate filesystem characters (spaces, &, ', $, unicode) are permitted because
 * shell quoting handles them safely on command construction. Dangerous control
 * characters (null bytes, newlines) and path traversal are rejected.
 */
export function isValidOmpSessionId(id: unknown): id is string {
  if (typeof id !== 'string' || id.length === 0 || id.length > 4096) return false;
  // Reject control characters
  if (/[\0\r\n]/.test(id)) return false;

  // Must end with .jsonl
  if (!id.toLowerCase().endsWith('.jsonl')) return false;

  // Reject directory traversal segments
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(id)) return false;

  // Must be an absolute path (Windows drive letter C:\, UNC \\server, or POSIX /)
  const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/.test(id) || /^[\\/]{2}[^\\/]+[\\/]+[^\\/]+/.test(id);
  const isPosixAbsolute = id.startsWith('/');

  return isWindowsAbsolute || isPosixAbsolute;
}

/**
 * `undefined` from the lookup means "no opinion" and keeps what the persisted
 * copy already had: a restored omp pane that has not reported yet must not
 * lose its handle to the first auto-save.
 */
export function stampOmpSessionIds<T>(tree: T, lookup: (id: SurfaceId) => string | null | undefined): T {
  return mapSurfaces(tree, surface => {
    if (surface.type !== 'terminal') return surface;
    const found = lookup(surface.id as SurfaceId);
    if (found === undefined) return surface;
    const next = isValidOmpSessionId(found) ? found : undefined;
    if (next === surface.ompSessionId) return surface;
    if (next) return { ...surface, ompSessionId: next };
    const rest = { ...surface };
    delete rest.ompSessionId;
    return rest;
  });
}

/**
 * Drop stamped omp session paths whose session file is no longer on disk,
 * before restoring panes. This prevents launching `omp --resume <path>`
 * on deleted sessions, which would fail or prompt in an unhelpful way.
 */
export function pruneDeadOmpSessions<T>(tree: T, exists: (file: string) => boolean = fs.existsSync): { tree: T; dropped: number } {
  let dropped = 0;
  const pruned = mapSurfaces(tree, surface => {
    if (surface.type !== 'terminal' || typeof surface.ompSessionId !== 'string') return surface;
    if (!isCheckableHere(surface.ompSessionId) || safeExists(exists, surface.ompSessionId)) return surface;
    dropped++;
    const rest = { ...surface };
    delete rest.ompSessionId;
    return rest;
  });
  return { tree: pruned, dropped };
}

/**
 * Only a drive-letter path is answerable from here. A POSIX path is an omp
 * running inside WSL or over ssh — Node on Windows would resolve `/home/u/…`
 * to `C:\home\u\…` and drop every such handle — and a UNC path (`\\wsl$\…`, a
 * share) can stall startup on the network. Those are kept; omp itself reports
 * a missing file when it is resumed.
 */
function isCheckableHere(file: string): boolean {
  return process.platform !== 'win32' ? file.startsWith('/') : /^[a-zA-Z]:[\\/]/.test(file);
}

function safeExists(exists: (file: string) => boolean, file: string): boolean {
  try {
    return exists(file);
  } catch {
    return false;
  }
}
