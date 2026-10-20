import { describe, it, expect, afterEach } from 'vitest';
import { execFile } from 'child_process';
import net from 'net';
import path from 'path';

/**
 * What the hook helper forwards for a hook registered in Qwen Code's settings
 * (`--provider qwen`, written by qwen-context.ts).
 *
 * Qwen's payload is Claude's in shape, so the risk is not a parse failure but a
 * MISREAD: its `session_id` filed as a Claude session (a restore would then type
 * `claude --resume <qwen-id>`), its runtime tool ids reaching consumers that key
 * on Claude's names, and its tool-result continuations — which also fire
 * UserPromptSubmit — landing in the prompt log as things the user typed.
 *
 * Run against the real compiled resources/cli/wmux-hook.js over its TCP remote
 * transport, like wmux-hook-payload-size.test.ts.
 */

const HOOK_SCRIPT = path.resolve(__dirname, '../../resources/cli/wmux-hook.js');
const QWEN_ID = '0f8e6b0c-3c1a-4a5e-9b7d-2a1c3e4f5a6b';

function runHook(args: string[], env: Record<string, string>, stdin: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [HOOK_SCRIPT, ...args], { env, timeout: 15000 }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    child.stdin?.end(stdin);
  });
}

interface CapturingServer {
  port: number;
  requests: Promise<any>;
  close: () => Promise<void>;
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((done) => server.close(() => done()));
}

function startCapturingServer(): Promise<CapturingServer> {
  let deliver: (frame: any) => void;
  const requests = new Promise<any>((r) => { deliver = r; });
  const server = net.createServer((socket) => {
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
      if (!data.includes('\n')) return;
      deliver(JSON.parse(data.trim()));
      socket.end();
    });
  });
  const close = () => closeServer(server);
  return new Promise((ready) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      ready({ port: typeof addr === 'object' && addr ? addr.port : 0, requests, close });
    });
  });
}

function envFor(port: number): Record<string, string> {
  const env = { ...process.env } as Record<string, string>;
  delete env.GROK_HOOK_EVENT;
  return { ...env, WMUX_REMOTE: `127.0.0.1:${port}`, WMUX_REMOTE_TOKEN: 't', WMUX_SURFACE_ID: 'surf-qwen' };
}

describe('wmux-hook.js under Qwen Code (--provider qwen)', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    if (close) await close();
    close = undefined;
  });

  async function send(args: string[], payload: unknown): Promise<any> {
    const server = await startCapturingServer();
    close = server.close;
    await runHook(args, envFor(server.port), JSON.stringify(payload));
    return (await server.requests).params;
  }

  it('tags the session id as Qwen\'s', async () => {
    const params = await send(['--event', 'SessionStart', '--provider', 'qwen'], {
      session_id: QWEN_ID, hook_event_name: 'SessionStart', source: 'startup',
    });
    expect(params.event).toBe('SessionStart');
    expect(params.sessionId).toBe(QWEN_ID);
    expect(params.provider).toBe('qwen');
  });

  it('translates Qwen tool ids to the Claude names wmux keys on', async () => {
    const params = await send(['--event', 'PreToolUse', '--provider', 'qwen'], {
      session_id: QWEN_ID, hook_event_name: 'PreToolUse', tool_name: 'run_shell_command', tool_input: { command: 'ls' },
    });
    expect(params.tool).toBe('Bash');
  });

  it('keeps the per-tool argv name and reads the edited file path', async () => {
    const params = await send(['Edit', '--provider', 'qwen'], {
      session_id: QWEN_ID, hook_event_name: 'PostToolUse', tool_name: 'edit', tool_input: { file_path: 'C:/repo/a.ts' },
    });
    expect(params.tool).toBe('Edit');
    expect(params.event).toBeUndefined();
    expect(params.file).toBe('C:/repo/a.ts');
  });

  it('logs submitted_prompt, the text a human typed', async () => {
    const params = await send(['--event', 'UserPromptSubmit', '--provider', 'qwen'], {
      session_id: QWEN_ID, hook_event_name: 'UserPromptSubmit', prompt: 'expanded @file text', submitted_prompt: 'fix the bug',
    });
    expect(params.prompt).toBe('fix the bug');
  });

  it('logs nothing for a continuation, which has no submitted_prompt', async () => {
    const params = await send(['--event', 'UserPromptSubmit', '--provider', 'qwen'], {
      session_id: QWEN_ID, hook_event_name: 'UserPromptSubmit', prompt: '[tool result] 3 files changed',
    });
    expect(params.event).toBe('UserPromptSubmit');
    expect(params.prompt).toBeUndefined();
  });

  it('drops a subagent-suffixed id rather than overwrite the pane\'s handle', async () => {
    const params = await send(['--event', 'SubagentStop', '--provider', 'qwen'], {
      session_id: `${QWEN_ID}-agent-explore`, hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'explore',
    });
    expect(params.sessionId).toBeUndefined();
    expect(params.agentId).toBe('a1');
  });

  it('reports StopFailure as the turn ending', async () => {
    const params = await send(['--event', 'StopFailure', '--provider', 'qwen'], {
      session_id: QWEN_ID, hook_event_name: 'StopFailure', error: 'rate_limit',
    });
    expect(params.event).toBe('Stop');
  });

  it('leaves a Claude Code hook exactly as it was: no provider, prompt as sent', async () => {
    const params = await send(['--event', 'UserPromptSubmit'], {
      session_id: 'abc123DEF-456_789', hook_event_name: 'UserPromptSubmit', prompt: 'hello',
    });
    expect(params.provider).toBeUndefined();
    expect(params.prompt).toBe('hello');
    expect(params.sessionId).toBe('abc123DEF-456_789');
  });
});
