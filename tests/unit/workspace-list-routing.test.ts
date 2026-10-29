/**
 * #398: `wmux list-workspaces` answered `{"manifests": []}`.
 *
 * Workspace manifests (#284) registered their "trusted manifests" listing as
 * `workspace.list`, which was already the bridge method behind
 * `list-workspaces`. `routeSpecialV2` in index.ts consults
 * WORKSPACE_MANIFEST_METHODS BEFORE the bridge table, so the manifest handler
 * silently took the name over and nobody could list their workspaces any more.
 * The invariant pinned here is the general one: no manifest method may share a
 * name with a bridge method, since whichever is matched first wins unseen.
 */
import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  dialog: {},
}));

import { handleBridgeV2 } from '../../src/main/v2-bridge';
import { WORKSPACE_MANIFEST_METHODS } from '../../src/main/workspace-manifest-v2';

describe('workspace list routing (#398)', () => {
  it('no manifest method shadows a bridge method', () => {
    for (const method of WORKSPACE_MANIFEST_METHODS) {
      expect(handleBridgeV2(method, {}, vi.fn(), vi.fn()), method).toBe(false);
    }
  });

  it('workspace.list is the bridge\'s workspace listing, not the manifest one', async () => {
    expect(WORKSPACE_MANIFEST_METHODS.has('workspace.list')).toBe(false);
    const respond = vi.fn();
    expect(handleBridgeV2('workspace.list', {}, respond, vi.fn())).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ workspaces: [] }));
  });

  it('the CLI sends list-workspaces and workspace list to different methods', () => {
    const cli = fs.readFileSync(path.join(__dirname, '../../src/cli/wmux.ts'), 'utf-8');
    expect(cli).toMatch(/'list-workspaces': async \(\) => print\(await sendV2\('workspace\.list'\)\)/);
    expect(cli).toMatch(/sub === 'list'\) \{\s*print\(await sendV2\('workspace\.list_manifests'/);
    expect(WORKSPACE_MANIFEST_METHODS.has('workspace.list_manifests')).toBe(true);
  });
});
