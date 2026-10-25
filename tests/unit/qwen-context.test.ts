import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  applyQwenHooks,
  ensureQwenContext,
  ensureQwenHooks,
  ensureQwenMcp,
  getQwenContextPath,
  getQwenHome,
  getQwenSettingsPath,
  QWEN_HOOK_EVENTS,
  qwenEventHookCommand,
  qwenHookTarget,
  QWEN_HOOK_STUB,
  removeQwenContext,
  removeQwenHooks,
  removeQwenHooksFrom,
  removeQwenMcp,
} from '../../src/main/qwen-context';

/**
 * Qwen Code does not read Claude Code's files, so wmux writes the Claude
 * integration again into ~/.qwen. What this suite pins is that those writes
 * stay guests in a file Qwen owns — every user key and hook kept, nothing at
 * all on a machine that never ran Qwen, and an exact inverse (#132).
 */
describe('qwen context', () => {
  let tmp: string;
  let saved: Record<string, string | undefined>;
  const KEYS = ['USERPROFILE', 'HOME', 'QWEN_HOME'];
  const HOOK = 'C:/wmux/resources/cli/wmux-hook.js';

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-qwen-'));
    saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
    process.env.USERPROFILE = tmp;
    process.env.HOME = tmp;
    delete process.env.QWEN_HOME;
    expect(os.homedir()).toBe(tmp);
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const userSettings = () => ({
    $version: 3,
    model: { name: 'qwen27-32k' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] },
    mcpServers: { mine: { command: 'my-server' } },
  });

  describe('home resolution', () => {
    it('defaults to ~/.qwen and honours only an absolute QWEN_HOME', () => {
      expect(getQwenHome()).toBe(path.join(tmp, '.qwen'));
      expect(getQwenHome({ QWEN_HOME: 'relative/dir' })).toBe(path.join(tmp, '.qwen'));
      const abs = path.join(tmp, 'elsewhere');
      expect(getQwenHome({ QWEN_HOME: abs })).toBe(abs);
    });
  });

  describe('never on a machine that has not run Qwen', () => {
    it('writes nothing when ~/.qwen does not exist', () => {
      ensureQwenContext();
      ensureQwenHooks();
      ensureQwenMcp();
      expect(fs.existsSync(path.join(tmp, '.qwen'))).toBe(false);
    });
  });

  describe('QWEN.md', () => {
    beforeEach(() => fs.mkdirSync(path.join(tmp, '.qwen')));

    it('appends the block after the user\'s text and takes it back out', () => {
      fs.writeFileSync(getQwenContextPath(), '# My rules\n\nBe terse.\n');
      ensureQwenContext();
      const written = fs.readFileSync(getQwenContextPath(), 'utf-8');
      expect(written.startsWith('# My rules\n\nBe terse.\n')).toBe(true);
      expect(written).toContain('<!-- wmux:start');
      removeQwenContext();
      expect(fs.readFileSync(getQwenContextPath(), 'utf-8')).toBe('# My rules\n\nBe terse.\n');
    });

    it('deletes a QWEN.md that held nothing but the block', () => {
      ensureQwenContext();
      expect(fs.existsSync(getQwenContextPath())).toBe(true);
      removeQwenContext();
      expect(fs.existsSync(getQwenContextPath())).toBe(false);
    });
  });

  describe('hooks (pure)', () => {
    it('registers every event with --provider qwen, plus per-tool PostToolUse', () => {
      const next = applyQwenHooks({}, HOOK);
      for (const event of QWEN_HOOK_EVENTS) expect(next.hooks[event]?.length).toBeGreaterThan(0);
      expect(next.hooks.StopFailure[0].hooks[0].command).toBe(qwenEventHookCommand(HOOK, 'StopFailure'));
      expect(next.hooks.StopFailure[0].hooks[0].command).toBe(`node ${HOOK} --event StopFailure --provider qwen`);
      const bash = next.hooks.PostToolUse.find((e: any) => e.matcher === 'Bash');
      expect(bash.hooks[0].command).toBe(`node ${HOOK} Bash --provider qwen`);
    });

    // Qwen on Windows runs a hook through cmd.exe /d /s /c WITHOUT verbatim
    // arguments, so Node turns every `"` into `\"` that cmd never unescapes and
    // node gets a literal quote. A path that needs no quotes must get none.
    it('writes a space-free script path bare, and quotes only one that needs it', () => {
      expect(qwenHookTarget('C:/Users/me/.qwen/wmux-qwen-hook.cjs')).toBe('C:/Users/me/.qwen/wmux-qwen-hook.cjs');
      expect(qwenHookTarget('C:/Users/John Smith/.qwen/wmux-qwen-hook.cjs')).toBe('"C:/Users/John Smith/.qwen/wmux-qwen-hook.cjs"');
      expect(qwenHookTarget('C:/a&b/x.cjs')).toBe('"C:/a&b/x.cjs"');
    });

    it('replaces the quoted ≤ 2.42.0 entry pointing into a spaced install path', () => {
      const legacy = 'node "C:/Users/me/OneDrive - Org/wmux/resources/cli/wmux-hook.js" --event Stop --provider qwen';
      const old = { hooks: { Stop: [{ hooks: [{ type: 'command', command: legacy }] }] } };
      const next = applyQwenHooks(old, 'C:/Users/me/.qwen/wmux-qwen-hook.cjs');
      expect(next.hooks.Stop).toHaveLength(1);
      expect(next.hooks.Stop[0].hooks[0].command).toBe('node C:/Users/me/.qwen/wmux-qwen-hook.cjs --event Stop --provider qwen');
      expect(removeQwenHooksFrom(next)).toEqual({});
    });

    it('keeps user hooks and keys, and is idempotent', () => {
      const once = applyQwenHooks(userSettings(), HOOK);
      const twice = applyQwenHooks(once, HOOK);
      expect(twice).toEqual(once);
      expect(once.$version).toBe(3);
      expect(once.hooks.Stop[0].hooks[0].command).toBe('say done');
      expect(once.hooks.Stop).toHaveLength(2);
    });

    it('removal is the exact inverse', () => {
      const original = userSettings();
      expect(removeQwenHooksFrom(applyQwenHooks(original, HOOK))).toEqual(original);
      expect(removeQwenHooksFrom(applyQwenHooks({ a: 1 }, HOOK))).toEqual({ a: 1 });
    });

    it('re-registers over a wmux entry written from another install path', () => {
      const old = applyQwenHooks({}, 'D:/old/wmux-hook.js');
      const next = applyQwenHooks(old, HOOK);
      expect(JSON.stringify(next)).not.toContain('D:/old');
    });
  });

  describe('settings.json on disk', () => {
    beforeEach(() => fs.mkdirSync(path.join(tmp, '.qwen')));

    it('adds hooks and MCP, then removes both, restoring the user\'s file', () => {
      fs.writeFileSync(getQwenSettingsPath(), JSON.stringify(userSettings(), null, 2));
      ensureQwenHooks();
      ensureQwenMcp();
      const written = JSON.parse(fs.readFileSync(getQwenSettingsPath(), 'utf-8'));
      expect(written.hooks.SessionStart).toBeDefined();
      expect(written.mcpServers['chrome-devtools'].args).toContain('--browserUrl=http://127.0.0.1:9222');
      expect(written.mcpServers.mine).toEqual({ command: 'my-server' });
      removeQwenHooks();
      removeQwenMcp();
      expect(JSON.parse(fs.readFileSync(getQwenSettingsPath(), 'utf-8'))).toEqual(userSettings());
    });

    it('runs hooks through a stub in Qwen\'s home that requires the real helper, and removes it', () => {
      fs.writeFileSync(getQwenSettingsPath(), '{}');
      ensureQwenHooks();
      const stub = path.join(getQwenHome(), QWEN_HOOK_STUB);
      const source = fs.readFileSync(stub, 'utf-8');
      expect(source).toMatch(/^require\(".*wmux-hook\.js"\);$/m);
      const written = JSON.parse(fs.readFileSync(getQwenSettingsPath(), 'utf-8'));
      const stubRef = stub.split(path.sep).join('/');
      expect(written.hooks.Stop[0].hooks[0].command).toBe(qwenEventHookCommand(stubRef, 'Stop'));
      removeQwenHooks();
      expect(fs.existsSync(stub)).toBe(false);
    });

    it('never deletes a user file that happens to carry the stub\'s name', () => {
      const stub = path.join(getQwenHome(), QWEN_HOOK_STUB);
      fs.writeFileSync(stub, 'console.log("mine")\n');
      removeQwenHooks();
      expect(fs.readFileSync(stub, 'utf-8')).toBe('console.log("mine")\n');
    });

    it('leaves a settings.json with comments alone rather than strip them', () => {
      const jsonc = '{\n  // my model\n  "model": { "name": "x" }\n}\n';
      fs.writeFileSync(getQwenSettingsPath(), jsonc);
      ensureQwenHooks();
      expect(fs.readFileSync(getQwenSettingsPath(), 'utf-8')).toBe(jsonc);
    });

    it('keeps a chrome-devtools entry the user pointed elsewhere', () => {
      const own = { mcpServers: { 'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@latest'] } } };
      fs.writeFileSync(getQwenSettingsPath(), JSON.stringify(own));
      ensureQwenMcp();
      removeQwenMcp();
      expect(JSON.parse(fs.readFileSync(getQwenSettingsPath(), 'utf-8'))).toEqual(own);
    });
  });
});
