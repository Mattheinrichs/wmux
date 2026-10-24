import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * `[terminal] osc-title-tabs` was parsed by user-config.ts (#221) and documented
 * in docs/config.md, but App.tsx's applyUserConfigTerminal never copied it onto
 * the store, so setting it in config.toml did nothing. `osc-title-workspaces`
 * (#343) arrived with the same gap. The apply function is module-private, so
 * the wiring is pinned on the source like the other App.tsx wiring tests.
 */
describe('applyUserConfigTerminal wiring', () => {
  const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'App.tsx'), 'utf8');
  const body = APP.slice(APP.indexOf('function applyUserConfigTerminal'), APP.indexOf('/** Find the bottom-most pane'));

  it.each(['oscTitleTabs', 'oscTitleWorkspaces'])('applies terminal.%s', (key) => {
    expect(body).toContain(`if (terminal.${key} !== undefined) patch.${key} = terminal.${key};`);
  });
});
