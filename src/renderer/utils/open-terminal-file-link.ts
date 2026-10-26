import { useStore } from '../store';
import { findSurfaceOwner } from '../store/split-utils';
import { openInPreviewTab } from '../components/Explorer/open-preview';
import type { SurfaceId, TerminalFileLinkResult } from '../../shared/types';

export async function resolveTerminalFileLink(surfaceId: SurfaceId, path: string): Promise<TerminalFileLinkResult> {
  const result = await window.wmux?.explorer?.resolveTerminalLink?.(surfaceId, path);
  return result ?? { error: 'Unavailable', code: 'read_failed' };
}

export async function terminalFileLinkExists(surfaceId: SurfaceId, path: string): Promise<boolean> {
  return !('error' in (await resolveTerminalFileLink(surfaceId, path)));
}

export async function openTerminalFileLink(surfaceId: SurfaceId, path: string): Promise<void> {
  const target = await resolveTerminalFileLink(surfaceId, path);
  if ('error' in target) return;
  const owner = findSurfaceOwner(useStore.getState().workspaces, surfaceId);
  if (!owner) return;

  if (target.kind === 'markdown') {
    const read = await window.wmux?.markdown?.readFile?.(target.absPath);
    if (!read || 'error' in read) return;
    const created = useStore.getState().addSurface(owner.workspaceId, owner.paneId, 'markdown');
    if (!created) return;
    useStore.getState().setMarkdownContent(created, read.content, {
      fileName: target.name, filePath: read.filePath, mtimeMs: read.mtimeMs,
    });
    return;
  }

  if (target.viewable) {
    const failure = await openInPreviewTab(owner.workspaceId, owner.paneId, target.absPath, target.name, {
      keep: false, surfaceId, relPath: target.relPath,
    });
    if (failure !== 'binary' && failure !== 'too_large') return;
  }
  // Never launch the default app from a terminal link: the text is whatever a
  // repo, a remote host or an agent printed, and a Ctrl+click on a .docm or an
  // .iso would run or mount it in one gesture. The explorer's "Open in default
  // app" stays a deliberate menu choice; here the file is only revealed.
  await window.wmux?.explorer?.reveal?.(surfaceId, target.relPath);
}
