import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as path from 'path';

/**
 * Issue #310 — the CLI-side (TUI) half, session reporting first.
 *
 * The core is a plain ESM module under resources/opencode-plugin/ because that
 * is exactly what gets installed into OpenCode's config directory. It must not
 * import @opencode/plugin/tui or solid-js (the TUI host provides those at
 * runtime; the wmux test suite cannot resolve them), so everything worth
 * testing lives here and the entry file is only the reactive glue.
 */
const calls: Array<{ file: string; argv: string[]; opts: any }> = [];

vi.mock('node:child_process', () => ({
  execFile: (file: string, argv: string[], opts: any, cb: any) => {
    calls.push({ file, argv, opts });
    if (typeof cb === 'function') cb(null, '', '');
  },
}));

const CORE = path.resolve(__dirname, '../../resources/opencode-plugin/wmux-tui-core.js');
const load = () => import(/* @vite-ignore */ CORE);

const SURFACE = 'surf-1';

beforeEach(() => {
  calls.length = 0;
});

describe('planSessionReport (#310)', () => {
  it('reports the viewed session id', async () => {
    const { planSessionReport } = await load();
    expect(planSessionReport({ type: 'session', sessionID: 'ses_abc12345' }, (id: string) => id))
      .toBe('ses_abc12345');
  });

  it('resolves a viewed subagent to its root — a child is not a resumable handle', async () => {
    const { planSessionReport } = await load();
    expect(planSessionReport(
      { type: 'session', sessionID: 'ses_child123' },
      () => 'ses_root1234',
    )).toBe('ses_root1234');
  });

  it('falls back to the viewed id when the root lookup throws or answers nothing', async () => {
    const { planSessionReport } = await load();
    const route = { type: 'session', sessionID: 'ses_abc12345' };
    expect(planSessionReport(route, () => { throw new Error('gone'); })).toBe('ses_abc12345');
    expect(planSessionReport(route, () => undefined)).toBe('ses_abc12345');
  });

  it('ignores every route that is not a session, and ids that fail the validator', async () => {
    const { planSessionReport } = await load();
    expect(planSessionReport({ type: 'home' }, (id: string) => id)).toBeNull();
    expect(planSessionReport(null, (id: string) => id)).toBeNull();
    expect(planSessionReport({ type: 'session' }, (id: string) => id)).toBeNull();
    expect(planSessionReport({ type: 'session', sessionID: 'not-a-session' }, (id: string) => id)).toBeNull();
  });
});

describe('createSessionReporter (#310)', () => {
  const reporterFor = async (overrides: { surface?: string; log?: any } = {}) => {
    const { createSessionReporter } = await load();
    const sent: string[][] = [];
    const reporter = createSessionReporter({
      surface: overrides.surface ?? SURFACE,
      callWmux: (argv: string[]) => sent.push(argv),
      log: overrides.log,
    });
    return { reporter, sent };
  };
  const route = (id: string) => ({ type: 'session', sessionID: id });
  const rootOf = (id: string) => id;

  it('reports once per session, with the pane attached', async () => {
    const { reporter, sent } = await reporterFor();
    reporter.observe(route('ses_abc12345'), rootOf);
    reporter.observe(route('ses_abc12345'), rootOf);
    expect(sent).toEqual([['report-session', 'ses_abc12345', '--provider', 'opencode', '--surface', SURFACE]]);
  });

  it('follows navigation to a different session', async () => {
    const { reporter, sent } = await reporterFor();
    reporter.observe(route('ses_abc12345'), rootOf);
    reporter.observe(route('ses_def67890'), rootOf);
    expect(sent.map((argv: string[]) => argv[1])).toEqual(['ses_abc12345', 'ses_def67890']);
  });

  it('releases the last session on dispose, exactly once', async () => {
    const { reporter, sent } = await reporterFor();
    reporter.observe(route('ses_abc12345'), rootOf);
    reporter.dispose();
    reporter.dispose();
    expect(sent).toEqual([
      ['report-session', 'ses_abc12345', '--provider', 'opencode', '--surface', SURFACE],
      ['release-agent', '--provider', 'opencode', '--session', 'ses_abc12345', '--surface', SURFACE],
    ]);
  });

  it('releases nothing when no session was ever viewed', async () => {
    const { reporter, sent } = await reporterFor();
    reporter.observe({ type: 'home' }, rootOf);
    reporter.dispose();
    expect(sent).toEqual([]);
  });

  it('stops reporting after dispose — a disposed TUI must not resurrect a handle', async () => {
    const { reporter, sent } = await reporterFor();
    reporter.dispose();
    reporter.observe(route('ses_abc12345'), rootOf);
    expect(sent).toEqual([]);
  });
});

describe('callWmux (#310)', () => {
  const runtimeNode = { file: ':node:', electron: false };

  it('runs the shipped CLI on the resolved JS runtime, argv untouched', async () => {
    const { callWmux } = await load();
    const env = { WMUX_CLI: 'C:\\wmux\\resources\\cli\\wmux.js' };
    callWmux(runtimeNode, ['report-session', 'ses_abc12345'], () => {}, env);
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe(':node:');
    expect(calls[0].argv).toEqual(['C:\\wmux\\resources\\cli\\wmux.js', 'report-session', 'ses_abc12345']);
    expect(calls[0].opts.env).toBeUndefined();
  });

  it('marks wmux\'s own Electron binary as Node, or a second wmux window opens', async () => {
    const { callWmux } = await load();
    const env = { WMUX_CLI: 'wmux.js' };
    callWmux({ file: 'wmux.exe', electron: true }, ['x'], () => {}, env);
    expect(calls[0].opts.env.ELECTRON_RUN_AS_NODE).toBe('1');
  });

  it('skips on Windows without WMUX_CLI — execFile cannot spawn the .cmd shim', async () => {
    const { callWmux } = await load();
    callWmux(runtimeNode, ['x'], () => {}, {}, 'win32');
    expect(calls).toEqual([]);
  });

  it('falls back to `wmux` on PATH elsewhere', async () => {
    const { callWmux } = await load();
    callWmux(runtimeNode, ['x'], () => {}, {}, 'linux');
    expect(calls[0]).toMatchObject({ file: 'wmux', argv: ['x'] });
  });
});
