import { describe, it, expect } from 'vitest';
import { launchedAgent, lastAgentLauncher, mergeResume } from '../../src/renderer/hooks/agent-launcher';

describe('launchedAgent', () => {
  it.each([
    ['opencode', 'opencode'],
    ['opencode --server https://code.homenode.stream', 'opencode'],
    ['opencode2 --server https://code.homenode.stream', 'opencode'],
    ['opencode2', 'opencode'],
    ['C:\\Tools\\opencode.exe', 'opencode'],
    ['/usr/local/bin/opencode', 'opencode'],
    ['"C:\\Program Files\\opencode.cmd" --server x', 'opencode'],
    ['npx -y opencode', 'opencode'],
    ['npx opencode --server x', 'opencode'],
    ['pnpm dlx codex', 'codex'],
    ['codex --yolo', 'codex'],
    ['claude', 'claude'],
    ['claude-code', 'claude'],
    ['claude2 --model sonnet', 'claude'],
  ])('%s -> %s', (command, agent) => {
    expect(launchedAgent(command)).toBe(agent);
  });

  it.each([
    // Exact match, never a prefix: this is somebody else's program.
    'opencode-monitor',
    'opencode-dev-server',
    // Quoting this would need a shell parser; being wrong here corrupts a
    // command that is not the agent's.
    'bash -c "opencode"',
    'echo opencode',
    'nvm use',
    'npx',
    'npm run opencode',
    '',
    '   ',
  ])('%s -> undefined', (command) => {
    expect(launchedAgent(command)).toBeUndefined();
  });
});

describe('lastAgentLauncher', () => {
  it('finds nothing in a setup-only base', () => {
    expect(lastAgentLauncher(['nvm use', 'cd packages/app'])).toBeUndefined();
  });

  it('finds the launcher among setup commands', () => {
    expect(lastAgentLauncher(['nvm use', 'opencode2 --server x'])).toEqual({ index: 1, agent: 'opencode' });
  });

  it('takes the last launcher when a pane names two', () => {
    expect(lastAgentLauncher(['opencode', 'claude'])).toEqual({ index: 1, agent: 'claude' });
  });
});

describe('mergeResume', () => {
  it('appends when every command is setup', () => {
    expect(mergeResume(['nvm use'], 'claude', 'abc')).toEqual(['nvm use', 'claude --resume abc']);
  });

  it('appends when there are no commands at all', () => {
    expect(mergeResume(undefined, 'opencode', 'ses_abc')).toEqual(['opencode -s ses_abc']);
  });

  it('merges into the pane\'s own launcher, keeping its name and flags (#302)', () => {
    expect(mergeResume(['opencode2 --server https://code.homenode.stream'], 'opencode', 'ses_abc'))
      .toEqual(['opencode2 --server https://code.homenode.stream -s ses_abc']);
  });

  it('merges into a claude launcher after setup commands', () => {
    expect(mergeResume(['nvm use', 'claude --model sonnet'], 'claude', 'abc'))
      .toEqual(['nvm use', 'claude --model sonnet --resume abc']);
  });

  it('merges codex as a subcommand, flags before it', () => {
    expect(mergeResume(['codex --yolo'], 'codex', 'abc')).toEqual(['codex --yolo resume abc']);
  });

  it('adds nothing when the pane launches a different agent', () => {
    expect(mergeResume(['claude'], 'opencode', 'ses_abc')).toBeNull();
  });

  it('does not mutate the caller\'s array', () => {
    const base = ['opencode2 --server x'];
    mergeResume(base, 'opencode', 'ses_abc');
    expect(base).toEqual(['opencode2 --server x']);
  });
});
