// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewWorktreeModal, { isValidBranchName } from '../../src/renderer/components/Sidebar/NewWorktreeModal';
import { useStore } from '../../src/renderer/store';
import type { WorkspaceId } from '../../src/shared/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(input: HTMLInputElement, value: string) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  nativeInputValueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('isValidBranchName', () => {
  it('accepts valid branch names', () => {
    expect(isValidBranchName('main')).toBe(true);
    expect(isValidBranchName('feat/add-worktrees')).toBe(true);
    expect(isValidBranchName('fix_issue-123')).toBe(true);
    expect(isValidBranchName('v1.0.0.alpha')).toBe(true);
    expect(isValidBranchName('release/2026.10')).toBe(true);
  });

  it('rejects empty or excessively long names', () => {
    expect(isValidBranchName('')).toBe(false);
    expect(isValidBranchName('a'.repeat(201))).toBe(false);
    expect(isValidBranchName('a'.repeat(200))).toBe(true);
  });

  it('rejects dashes at start', () => {
    expect(isValidBranchName('-feature')).toBe(false);
    expect(isValidBranchName('--help')).toBe(false);
  });

  it('rejects consecutive dots', () => {
    expect(isValidBranchName('feature..test')).toBe(false);
    expect(isValidBranchName('..')).toBe(false);
  });

  it('rejects .lock extension', () => {
    expect(isValidBranchName('branch.lock')).toBe(false);
    expect(isValidBranchName('branch.lock.tmp')).toBe(true);
  });

  it('rejects leading/trailing slashes or dots', () => {
    expect(isValidBranchName('.branch')).toBe(false);
    expect(isValidBranchName('/branch')).toBe(false);
    expect(isValidBranchName('branch/')).toBe(false);
  });

  it('rejects whitespace and disallowed characters', () => {
    expect(isValidBranchName('feature branch')).toBe(false);
    expect(isValidBranchName('feat~1')).toBe(false);
    expect(isValidBranchName('feat^2')).toBe(false);
    expect(isValidBranchName('feat:bar')).toBe(false);
    expect(isValidBranchName('feat?')).toBe(false);
    expect(isValidBranchName('feat*')).toBe(false);
    expect(isValidBranchName('feat[0]')).toBe(false);
    expect(isValidBranchName('feat@{1}')).toBe(false);
    expect(isValidBranchName('feat\\test')).toBe(false);
  });
});

describe('NewWorktreeModal', () => {
  let root: Root;
  let host: HTMLDivElement;
  let mockProbe: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockProbe = vi.fn();
    mockCreate = vi.fn();

    (window as any).wmux = {
      worktree: {
        probe: mockProbe,
        create: mockCreate,
      },
    };

    useStore.setState({
      workspaces: [],
      activeWorkspaceId: null,
      language: 'en',
    });

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.innerHTML = '';
    delete (window as any).wmux;
  });

  it('shows notRepo warning and disables create button when probe returns null', async () => {
    mockProbe.mockResolvedValue(null);

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose: vi.fn(), cwd: '/not/a/repo' }));
    });

    expect(mockProbe).toHaveBeenCalledWith('/not/a/repo');

    expect(host.textContent).toContain('Current folder is not a Git repository');

    const submitBtn = host.querySelector<HTMLButtonElement>('.confirm-dialog__btn--primary')!;
    expect(submitBtn).toBeDefined();
    expect(submitBtn.disabled).toBe(true);

    const branchInput = host.querySelector<HTMLInputElement>('#worktree-branch-input')!;
    expect(branchInput.disabled).toBe(true);
  });

  it('pre-fills base ref from probe and enables branch input on success', async () => {
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'feat/starter' });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose: vi.fn(), cwd: '/repo/root' }));
    });

    expect(host.textContent).not.toContain('Current folder is not a Git repository');

    const branchInput = host.querySelector<HTMLInputElement>('#worktree-branch-input')!;
    expect(branchInput.disabled).toBe(false);

    const baseInput = host.querySelector<HTMLInputElement>('#worktree-base-input')!;
    expect(baseInput.value).toBe('feat/starter');

    const submitBtn = host.querySelector<HTMLButtonElement>('.confirm-dialog__btn--primary')!;
    // Submit disabled because branch input is empty
    expect(submitBtn.disabled).toBe(true);
  });

  it('defaults base ref to HEAD when probed currentBranch is empty', async () => {
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: '' });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose: vi.fn(), cwd: '/repo/root' }));
    });

    const baseInput = host.querySelector<HTMLInputElement>('#worktree-base-input')!;
    expect(baseInput.value).toBe('HEAD');
  });

  it('falls back to active workspace cwd when cwd prop is omitted', async () => {
    mockProbe.mockResolvedValue({ repoRoot: '/active/repo', currentBranch: 'main' });

    useStore.setState({
      workspaces: [
        {
          id: 'ws-active' as WorkspaceId,
          cwd: '/active/repo',
          title: 'Active Workspace',
        } as any,
      ],
      activeWorkspaceId: 'ws-active' as WorkspaceId,
    });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose: vi.fn() }));
    });

    expect(mockProbe).toHaveBeenCalledWith('/active/repo');
  });

  it('validates branch input live and displays error on invalid characters', async () => {
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'main' });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose: vi.fn(), cwd: '/repo/root' }));
    });

    const branchInput = host.querySelector<HTMLInputElement>('#worktree-branch-input')!;
    const submitBtn = host.querySelector<HTMLButtonElement>('.confirm-dialog__btn--primary')!;

    // Type invalid branch with spaces
    await act(async () => {
      setInputValue(branchInput, 'invalid branch name');
    });

    expect(host.textContent).toContain('Invalid branch name');
    expect(submitBtn.disabled).toBe(true);

    // Type valid branch
    await act(async () => {
      setInputValue(branchInput, 'valid-branch');
    });

    expect(host.textContent).not.toContain('Invalid branch name');
    expect(submitBtn.disabled).toBe(false);
  });

  it('creates worktree workspace successfully and selects it in store', async () => {
    const onClose = vi.fn();
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'main' });
    mockCreate.mockResolvedValue({
      ok: true,
      worktree: {
        repoRoot: '/repo/root',
        branch: 'feat/awesome',
        baseBranch: 'main',
        baseSha: '0123456789abcdef0123456789abcdef01234567',
        worktreePath: '/repo/root/.wmux/worktrees/feat-awesome',
      },
    });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose, cwd: '/repo/root' }));
    });

    const branchInput = host.querySelector<HTMLInputElement>('#worktree-branch-input')!;
    await act(async () => {
      setInputValue(branchInput, 'feat/awesome');
    });

    const submitBtn = host.querySelector<HTMLButtonElement>('.confirm-dialog__btn--primary')!;
    await act(async () => {
      submitBtn.click();
    });

    expect(mockCreate).toHaveBeenCalledWith('/repo/root', 'feat/awesome', 'main');

    const workspaces = useStore.getState().workspaces;
    expect(workspaces.length).toBe(1);
    expect(workspaces[0].title).toBe('feat/awesome');
    expect(workspaces[0].cwd).toBe('/repo/root/.wmux/worktrees/feat-awesome');
    expect(workspaces[0].worktree).toEqual({
      repoRoot: '/repo/root',
      branch: 'feat/awesome',
      baseBranch: 'main',
      baseSha: '0123456789abcdef0123456789abcdef01234567',
      worktreePath: '/repo/root/.wmux/worktrees/feat-awesome',
    });
    expect(useStore.getState().activeWorkspaceId).toBe(workspaces[0].id);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it.each([
    ['branch_exists', 'A branch with this name already exists'],
    ['branch_in_use', 'This branch is already checked out in another worktree'],
    ['invalid_branch', 'Invalid branch name'],
    ['not_a_repo', 'Not a Git repository'],
    ['custom_err', 'Failed to create worktree: Disk full'],
  ])('maps error code %s to localized error message', async (errorCode, expectedMessage) => {
    const onClose = vi.fn();
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'main' });
    mockCreate.mockResolvedValue({
      ok: false,
      code: errorCode,
      error: errorCode === 'custom_err' ? 'Disk full' : errorCode,
    });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose, cwd: '/repo/root' }));
    });

    const branchInput = host.querySelector<HTMLInputElement>('#worktree-branch-input')!;
    await act(async () => {
      setInputValue(branchInput, 'feature/test');
    });

    const submitBtn = host.querySelector<HTMLButtonElement>('.confirm-dialog__btn--primary')!;
    await act(async () => {
      submitBtn.click();
    });

    expect(host.textContent).toContain(expectedMessage);
    expect(onClose).not.toHaveBeenCalled();
    expect(useStore.getState().workspaces.length).toBe(0);
  });

  it('closes on overlay backdrop click', async () => {
    const onClose = vi.fn();
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'main' });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose, cwd: '/repo/root' }));
    });

    const overlay = host.querySelector<HTMLDivElement>('.confirm-dialog__overlay')!;
    await act(async () => {
      overlay.click();
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('does not close when clicking dialog inner content', async () => {
    const onClose = vi.fn();
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'main' });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose, cwd: '/repo/root' }));
    });

    const dialog = host.querySelector<HTMLDivElement>('.confirm-dialog')!;
    await act(async () => {
      dialog.click();
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape key press', async () => {
    const onClose = vi.fn();
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'main' });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose, cwd: '/repo/root' }));
    });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('submits on Enter key when form is valid', async () => {
    const onClose = vi.fn();
    mockProbe.mockResolvedValue({ repoRoot: '/repo/root', currentBranch: 'main' });
    mockCreate.mockResolvedValue({
      ok: true,
      worktree: {
        repoRoot: '/repo/root',
        branch: 'feat/enter',
        baseBranch: 'main',
        baseSha: 'abc',
        worktreePath: '/repo/root/.wmux/worktrees/feat-enter',
      },
    });

    await act(async () => {
      root.render(createElement(NewWorktreeModal, { onClose, cwd: '/repo/root' }));
    });

    const branchInput = host.querySelector<HTMLInputElement>('#worktree-branch-input')!;
    await act(async () => {
      setInputValue(branchInput, 'feat/enter');
    });

    const dialog = host.querySelector<HTMLDivElement>('.confirm-dialog')!;
    await act(async () => {
      dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(mockCreate).toHaveBeenCalledWith('/repo/root', 'feat/enter', 'main');
    expect(onClose).toHaveBeenCalledOnce();
  });
});
