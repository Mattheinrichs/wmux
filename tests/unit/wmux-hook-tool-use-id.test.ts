import { describe, it, expect } from 'vitest';
import { execFile } from 'child_process';
import net from 'net';
import path from 'path';

/**
 * Issue #399: a permission prompt is retracted once the main thread's tool
 * calls show the agent moved past it, which needs the hook helper to forward
 * Claude Code's `tool_use_id`, and only for calls wmux can attribute.
 */

const HOOK_SCRIPT = path.resolve(__dirname, '../../resources/cli/wmux-hook.js');

function runHook(args: string[], port: number, stdin: string): Promise<void> {
  const env = {
    ...process.env,
    WMUX_REMOTE: `127.0.0.1:${port}`,
    WMUX_REMOTE_TOKEN: 't',
    WMUX_SURFACE_ID: 'surf-tool-id',
  } as Record<string, string>;
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [HOOK_SCRIPT, ...args], { env, timeout: 15000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    child.stdin?.end(stdin);
  });
}

/** One hook process → the `hook.event` params it sent. */
async function hookParams(args: string[], payload: unknown): Promise<Record<string, any>> {
  let deliver!: (frame: any) => void;
  const frame = new Promise<any>((r) => { deliver = r; });
  const server = net.createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (!data.includes('\n')) return;
      deliver(JSON.parse(data.trim()));
      socket.end();
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', () => ready()));
  const addr = server.address();
  try {
    await runHook(args, typeof addr === 'object' && addr ? addr.port : 0, JSON.stringify(payload));
    return (await frame).params;
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

describe('wmux-hook.js tool_use_id (#399)', () => {
  it('forwards it on a PreToolUse', async () => {
    const params = await hookParams(['--event', 'PreToolUse'], {
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_01AbC',
    });
    expect(params.toolUseId).toBe('toolu_01AbC');
  });

  it('forwards it on a bare-tool PostToolUse', async () => {
    const params = await hookParams(['Bash'], {
      hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'toolu_01AbC',
    });
    expect(params.toolUseId).toBe('toolu_01AbC');
  });

  it('drops a value that is not an identifier', async () => {
    const params = await hookParams(['--event', 'PreToolUse'], {
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'not an id\n',
    });
    expect(params.toolUseId).toBeUndefined();
  });

  it('drops it inside a Grok subagent session, which carries no agent_id', async () => {
    const params = await hookParams(['--event', 'PreToolUse'], {
      hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'toolu_01AbC', subagentType: 'explore',
    });
    expect(params.toolUseId).toBeUndefined();
  });
});
