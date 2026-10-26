// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { create } from 'zustand';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceInfo, WorkspaceId, PaneId, SurfaceId, WorktreeMetadata } from '../../src/shared/types';
import WorkspaceRow from '../../src/renderer/components/Sidebar/WorkspaceRow';

const store = create(() => ({
  sidebarPrefs: { activeTabIndicator: 'leftRail', fullWidthTitles: false, wrapTitles: false },
  appearancePrefs: { uiMode: 'classic' },
  surfaceProgress: {},
  agentMeta: new Map(),
  agentIdentities: {},
  agentDetections: {},
}));

vi.mock('../../src/renderer/store', () => ({ get useStore() { return store; } }));
vi.mock('../../src/renderer/i18n', () => ({ useT: () => (_key: string, fallback: string) => fallback }));

const sampleWorktree: WorktreeMetadata = {
  repoRoot: 'C:\\projects\\wmux',
  branch: 'feat/wt-feature',
  baseBranch: 'main',
  baseSha: '0123456789abcdef0123456789abcdef01234567',
  worktreePath: 'C:\\projects\\wmux\\.wmux\\worktrees\\feat-wt-feature',
};

const baseWorkspace: WorkspaceInfo = {
  id: 'ws-1' as WorkspaceId,
  title: 'My Project',
  pinned: false,
  shell: 'pwsh',
  unreadCount: 0,
  splitTree: {
    type: 'leaf',
    paneId: 'pane-1' as PaneId,
    activeSurfaceIndex: 0,
    surfaces: [{ id: 's-1' as SurfaceId, type: 'terminal', title: 'term' }],
  },
};

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  document.body.innerHTML = '';
});

describe('WorkspaceRow worktree badge', () => {
  it('renders [WT] badge when workspace.worktree is present', () => {
    act(() => {
      root!.render(
        React.createElement(WorkspaceRow, {
          workspace: { ...baseWorkspace, worktree: sampleWorktree },
          isActive: false,
          onSelect: () => {},
          onClose: () => {},
        }),
      );
    });

    const badge = container.querySelector('.workspace-row__badge--worktree');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('[WT]');
    expect(badge?.getAttribute('title')).toBe('Worktree: feat/wt-feature (base: main)');
  });

  it('omits [WT] badge when workspace.worktree is undefined', () => {
    act(() => {
      root!.render(
        React.createElement(WorkspaceRow, {
          workspace: { ...baseWorkspace, worktree: undefined },
          isActive: false,
          onSelect: () => {},
          onClose: () => {},
        }),
      );
    });

    const badge = container.querySelector('.workspace-row__badge--worktree');
    expect(badge).toBeNull();
  });

  it('renders badge in fullWidthTitles mode as well', () => {
    store.setState({ sidebarPrefs: { activeTabIndicator: 'leftRail', fullWidthTitles: true, wrapTitles: false } });

    act(() => {
      root!.render(
        React.createElement(WorkspaceRow, {
          workspace: { ...baseWorkspace, worktree: sampleWorktree },
          isActive: false,
          onSelect: () => {},
          onClose: () => {},
        }),
      );
    });

    const badge = container.querySelector('.workspace-row__badge--worktree');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('[WT]');
  });
});
