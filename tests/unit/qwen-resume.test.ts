import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  getQwenRuntimeDir,
  isValidQwenSessionId,
  listKnownQwenSessionIds,
  pruneDeadQwenSessions,
  stampQwenSessionIds,
} from '../../src/main/qwen-resume';
import { withClaudeResume, resetResumedSurfaces } from '../../src/renderer/hooks/claude-resume-command';
import { mergeResume, launchedAgent } from '../../src/renderer/hooks/agent-launcher';

const ID = '0f8e6b0c-3c1a-4a5e-9b7d-2a1c3e4f5a6b';
const leaf = (surfaces: any[]) => ({ type: 'leaf', paneId: 'pane-1', surfaces });

describe('qwen resume, main side', () => {
  it('accepts only the strict UUID Qwen accepts', () => {
    expect(isValidQwenSessionId(ID)).toBe(true);
    expect(isValidQwenSessionId(ID.toUpperCase())).toBe(true);
    expect(isValidQwenSessionId(`${ID}-agent-explore`)).toBe(false);
    expect(isValidQwenSessionId('abc123DEF-456_789')).toBe(false); // a Claude-shaped id
    expect(isValidQwenSessionId(`${ID}; rm -rf /`)).toBe(false);
  });

  it('stamps, keeps on silence, and clears on release', () => {
    const tree = leaf([{ id: 's1', type: 'terminal' }, { id: 'b1', type: 'browser' }]);
    const stamped = stampQwenSessionIds(tree, () => ID) as any;
    expect(stamped.surfaces[0].qwenSessionId).toBe(ID);
    expect(stamped.surfaces[1].qwenSessionId).toBeUndefined();
    expect(stampQwenSessionIds(stamped, () => undefined)).toBe(stamped);
    expect((stampQwenSessionIds(stamped, () => null) as any).surfaces[0].qwenSessionId).toBeUndefined();
  });

  it('resolves the runtime dir: QWEN_RUNTIME_DIR, then QWEN_HOME, absolute only', () => {
    expect(getQwenRuntimeDir({}, 'H')).toBe(path.join('H', '.qwen'));
    const a = path.resolve('/qa'); const b = path.resolve('/qb');
    expect(getQwenRuntimeDir({ QWEN_HOME: b }, 'H')).toBe(b);
    expect(getQwenRuntimeDir({ QWEN_RUNTIME_DIR: a, QWEN_HOME: b }, 'H')).toBe(a);
    expect(getQwenRuntimeDir({ QWEN_HOME: 'rel' }, 'H')).toBe(path.join('H', '.qwen'));
  });

  describe('pruning', () => {
    let tmp: string;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-qwen-rt-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('lists transcripts under projects/*/chats and prunes the rest', () => {
      expect(listKnownQwenSessionIds(tmp)).toBeNull();
      const chats = path.join(tmp, 'projects', 'c--repo', 'chats');
      fs.mkdirSync(chats, { recursive: true });
      fs.writeFileSync(path.join(chats, `${ID}.jsonl`), '');
      const known = listKnownQwenSessionIds(tmp)!;
      expect([...known]).toEqual([ID]);
      const dead = '11111111-2222-4333-8444-555555555555';
      const tree = leaf([{ id: 's1', type: 'terminal', qwenSessionId: ID }, { id: 's2', type: 'terminal', qwenSessionId: dead }]);
      const { tree: pruned, dropped } = pruneDeadQwenSessions(tree, known);
      expect(dropped).toBe(1);
      expect((pruned as any).surfaces.map((s: any) => s.qwenSessionId)).toEqual([ID, undefined]);
      expect(pruneDeadQwenSessions(tree, null).dropped).toBe(0);
    });
  });
});

describe('qwen resume, renderer side', () => {
  beforeEach(() => resetResumedSurfaces());

  it('types qwen --resume once, only when enabled', () => {
    const base = { base: undefined, surfaceId: 's1', claudeSessionId: undefined, enabled: true, qwenSessionId: ID };
    expect(withClaudeResume({ ...base, qwenEnabled: false })).toBeUndefined();
    expect(withClaudeResume({ ...base, qwenEnabled: true })).toEqual([`qwen --resume ${ID}`]);
    expect(withClaudeResume({ ...base, qwenEnabled: true })).toBeUndefined();
  });

  it('never resumes a tab that also carries another agent\'s handle', () => {
    expect(withClaudeResume({
      base: undefined, surfaceId: 's2', claudeSessionId: 'abc123DEF-456', enabled: true, qwenSessionId: ID, qwenEnabled: true,
    })).toBeUndefined();
  });

  it('refuses an edited session.json value', () => {
    expect(withClaudeResume({
      base: undefined, surfaceId: 's3', claudeSessionId: undefined, enabled: true, qwenSessionId: `${ID} && calc`, qwenEnabled: true,
    })).toBeUndefined();
  });

  it('merges into a qwen launcher, and stays out of another agent\'s', () => {
    expect(launchedAgent('npx -y qwen')).toBe('qwen');
    expect(launchedAgent('qwen-code --yolo')).toBe('qwen');
    expect(mergeResume(['qwen --yolo'], 'qwen', ID)).toEqual([`qwen --yolo --resume ${ID}`]);
    expect(mergeResume(['claude'], 'qwen', ID)).toBeNull();
    expect(mergeResume(['nvm use 20'], 'qwen', ID)).toEqual(['nvm use 20', `qwen --resume ${ID}`]);
  });
});
