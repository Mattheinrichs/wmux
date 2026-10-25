// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewWorkspaceButton, { upwardMenuPosition } from '../../src/renderer/components/Sidebar/NewWorkspaceButton';
import { useStore } from '../../src/renderer/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The sidebar layout menu opens UPWARD from a button at the bottom of the window.

describe('upwardMenuPosition', () => {
  it('sits just above the anchor, aligned with it and at least as wide', () => {
    const pos = upwardMenuPosition({ left: 12, top: 700, width: 180 }, 800);
    expect(pos.left).toBe(12);
    expect(pos.minWidth).toBe(180);
    // bottom is measured from the bottom of the viewport: 100px below the
    // anchor's top, plus the 4px gap.
    expect(pos.bottom).toBe(104);
    // Everything above the anchor, minus the gap and an 8px top margin.
    expect(pos.maxHeight).toBe(688);
  });

  it('honours a custom gap and margin', () => {
    const pos = upwardMenuPosition({ left: 0, top: 500, width: 100 }, 600, 10, 20);
    expect(pos.bottom).toBe(110);
    expect(pos.maxHeight).toBe(470);
  });

  it('never gives a negative height when the anchor is near the top', () => {
    expect(upwardMenuPosition({ left: 0, top: 6, width: 100 }, 600).maxHeight).toBe(0);
  });
});

describe('NewWorkspaceButton component', () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    useStore.setState({ language: 'en', savedLayouts: [] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
  });

  it('invokes onNewWorktree callback when clicking the new worktree menu item', async () => {
    const onNewWorktree = vi.fn();
    const onCreate = vi.fn();
    const onCreateFromLayout = vi.fn();
    const onManageLayouts = vi.fn();

    await act(async () => {
      root.render(
        createElement(NewWorkspaceButton, {
          onCreate,
          onCreateFromLayout,
          onManageLayouts,
          onNewWorktree,
        }),
      );
    });

    const caretBtn = host.querySelector<HTMLButtonElement>('.sidebar__new-caret')!;
    expect(caretBtn).toBeDefined();

    await act(async () => {
      caretBtn.click();
    });

    const menuItems = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const worktreeItem = menuItems.find((item) =>
      item.textContent?.includes('New worktree workspace'),
    );
    expect(worktreeItem).toBeDefined();

    await act(async () => {
      worktreeItem!.click();
    });

    expect(onNewWorktree).toHaveBeenCalledOnce();
  });

  it('omits new worktree menu item when onNewWorktree prop is not provided', async () => {
    await act(async () => {
      root.render(
        createElement(NewWorkspaceButton, {
          onCreate: vi.fn(),
          onCreateFromLayout: vi.fn(),
          onManageLayouts: vi.fn(),
        }),
      );
    });

    const caretBtn = host.querySelector<HTMLButtonElement>('.sidebar__new-caret')!;
    await act(async () => {
      caretBtn.click();
    });

    const menuItems = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    const worktreeItem = menuItems.find((item) =>
      item.textContent?.includes('New worktree workspace'),
    );
    expect(worktreeItem).toBeUndefined();
  });
});
