import * as path from 'path';
import type { TerminalFileLinkResult } from '../shared/types';
import { resolveInRoot } from './explorer-fs';
import { isBinaryPath } from './code-file';
import { isAllowedMarkdownPath, statMarkdownFile } from './markdown-file';

export const MAX_LINK_TEXT = 1024;

const OUTSIDE_ROOT: TerminalFileLinkResult = { error: 'Path is outside the root', code: 'outside_root' };

function isInside(rel: string): boolean {
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
}

export async function resolveTerminalFileLink(
  realRoot: string | null,
  text: unknown,
): Promise<TerminalFileLinkResult> {
  if (typeof text !== 'string' || !text || text.length > MAX_LINK_TEXT || text.includes('\0')) {
    return { error: 'Invalid path', code: 'invalid_path' };
  }
  if (!realRoot && !path.isAbsolute(text)) return OUTSIDE_ROOT;

  const target = realRoot ? path.resolve(realRoot, text) : path.resolve(text);

  if (realRoot) {
    const rel = path.relative(realRoot, target);
    if (isInside(rel)) {
      const relPath = rel.split(path.sep).join('/');
      const resolved = await resolveInRoot(realRoot, relPath, 'file');
      if (!('error' in resolved)) {
        const name = path.basename(resolved.abs);
        return { kind: 'jailed', relPath, absPath: resolved.abs, name, viewable: !isBinaryPath(name) };
      }
      if (resolved.code !== 'outside_root') return resolved;
    }
  }

  if (!isAllowedMarkdownPath(target)) return OUTSIDE_ROOT;
  const stat = statMarkdownFile(target);
  if ('error' in stat) return { error: 'File not found', code: 'not_found' };
  return { kind: 'markdown', absPath: target, name: path.basename(target) };
}
