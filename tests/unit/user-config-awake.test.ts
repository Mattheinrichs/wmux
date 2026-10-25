import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadUserConfig } from '../../src/main/user-config';

function writeTmp(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-cfg-awake-'));
  const p = path.join(dir, 'config.toml');
  fs.writeFileSync(p, contents, 'utf-8');
  return p;
}

describe('user-config keep-awake parsing', () => {
  let tmpPath: string | null = null;

  afterEach(() => {
    if (tmpPath) {
      try { fs.rmSync(path.dirname(tmpPath), { recursive: true, force: true }); } catch { /* noop */ }
      tmpPath = null;
    }
  });

  it('parses [workspace.keep-awake] with valid settings', () => {
    tmpPath = writeTmp(`
      [workspace.keep-awake]
      mode = "always"
      prevent-display-sleep = true
    `);
    const out = loadUserConfig(tmpPath);
    expect(out.errors).toEqual([]);
    expect(out.workspace?.keepAwake).toEqual({
      mode: 'always',
      preventDisplaySleep: true,
    });
  });

  it('parses mode = "smart" and preventDisplaySleep camelCase', () => {
    tmpPath = writeTmp(`
      [workspace.keep-awake]
      mode = "smart"
      preventDisplaySleep = false
    `);
    const out = loadUserConfig(tmpPath);
    expect(out.errors).toEqual([]);
    expect(out.workspace?.keepAwake).toEqual({
      mode: 'smart',
      preventDisplaySleep: false,
    });
  });

  it('reports error on invalid keep-awake mode', () => {
    tmpPath = writeTmp(`
      [workspace.keep-awake]
      mode = "caffeine"
    `);
    const out = loadUserConfig(tmpPath);
    expect(out.errors).toContain('workspace.keep-awake.mode: "caffeine" not one of smart|always|off');
  });
});
