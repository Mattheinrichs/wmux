// #329: a layout preset is named BEFORE it exists. Every "save current layout"
// entry point opens the naming dialog through requestLayoutSave; only Save
// creates the preset, and the workspace to capture is fixed when the dialog opens.

import { describe, it, expect, beforeEach } from 'vitest';
import { useStore } from '../../src/renderer/store';
import { getAllPaneIds } from '../../src/renderer/store/split-utils';

function savedLayouts(): any[] {
  return (useStore.getState() as any).savedLayouts ?? [];
}

beforeEach(() => {
  for (const w of [...useStore.getState().workspaces]) useStore.getState().closeWorkspace(w.id);
  (useStore.getState() as any).setSavedLayouts?.([]);
  useStore.getState().cancelLayoutSave();
});

describe('layout preset naming dialog (#329)', () => {
  it('creates nothing until Save, then uses the entered (trimmed) name', () => {
    const ws = useStore.getState().createWorkspace({ title: 'ws' });
    useStore.getState().selectWorkspace(ws);

    expect(useStore.getState().requestLayoutSave('Layout 1')).toBe(true);
    expect(useStore.getState().pendingLayoutSave).toEqual({ workspaceId: ws, suggestedName: 'Layout 1' });
    expect(savedLayouts()).toHaveLength(0);

    const id = useStore.getState().confirmLayoutSave('  Agents team  ');
    expect(id).toBeTruthy();
    expect(savedLayouts().map((l) => l.name)).toEqual(['Agents team']);
    expect(useStore.getState().pendingLayoutSave).toBeNull();
  });

  it('Cancel creates no preset', () => {
    const ws = useStore.getState().createWorkspace({ title: 'ws' });
    useStore.getState().selectWorkspace(ws);
    useStore.getState().requestLayoutSave('Layout 1');
    useStore.getState().cancelLayoutSave();
    expect(useStore.getState().pendingLayoutSave).toBeNull();
    expect(savedLayouts()).toHaveLength(0);
  });

  it('refuses an empty name and keeps the dialog open', () => {
    const ws = useStore.getState().createWorkspace({ title: 'ws' });
    useStore.getState().selectWorkspace(ws);
    useStore.getState().requestLayoutSave('Layout 1');
    expect(useStore.getState().confirmLayoutSave('   ')).toBeNull();
    expect(useStore.getState().pendingLayoutSave).not.toBeNull();
    expect(savedLayouts()).toHaveLength(0);
  });

  it('captures the right-clicked workspace even when another one is active', () => {
    const a = useStore.getState().createWorkspace({ title: 'a' });
    const b = useStore.getState().createWorkspace({ title: 'b' });
    const treeOf = (id: string) => useStore.getState().workspaces.find((w) => w.id === id)!.splitTree;
    const aPanes = getAllPaneIds(treeOf(a));
    const bPanes = getAllPaneIds(treeOf(b));
    useStore.getState().selectWorkspace(a);

    useStore.getState().requestLayoutSave('b', b);
    // Focus moving while the dialog is up must not change what is saved.
    useStore.getState().selectWorkspace(a);
    const id = useStore.getState().confirmLayoutSave('b layout')!;

    const layout = savedLayouts().find((l) => l.id === id)!;
    const saved = JSON.stringify(layout.splitTree);
    expect(bPanes.every((p) => saved.includes(p))).toBe(true);
    expect(aPanes.some((p) => saved.includes(p))).toBe(false);
    expect(layout.name).toBe('b layout');
  });

  it('opens nothing without a workspace to capture', () => {
    expect(useStore.getState().requestLayoutSave('Layout 1')).toBe(false);
    expect(useStore.getState().pendingLayoutSave).toBeNull();
  });
});
