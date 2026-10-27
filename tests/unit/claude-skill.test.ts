import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';
import {
  SKILL_OWNER_MARKER,
  buildContextStub,
  buildSkillFile,
  getInstructionsPath,
  renderInstructions,
} from '../../src/main/agent-instructions';
import {
  ensureClaudeContext,
  getClaudeMdPath,
  getClaudeSkillPath,
  removeClaudeContext,
} from '../../src/main/claude-context';

/**
 * Issue #386: the full block cost 118 always-loaded lines in every Claude Code
 * session on the machine, wmux or not. It now ships as a skill, and CLAUDE.md
 * keeps only the presence check and the moments to load it.
 */
describe('wmux guidance as a Claude Code skill (issue #386)', () => {
  const block = renderInstructions(fs.readFileSync(getInstructionsPath(), 'utf-8'), 'C:\\wmux\\cli-bin');

  it('carries the whole block, without the splice markers, behind valid frontmatter', () => {
    const skill = buildSkillFile(block);
    expect(skill.startsWith('---\nname: wmux\ndescription: "')).toBe(true);
    expect(skill).toContain(SKILL_OWNER_MARKER);
    expect(skill).not.toContain('<!-- wmux:start');
    expect(skill).not.toContain('<!-- wmux:end');
    for (const section of ['## Browser', '## Markdown', '## Asking the user something', 'report-subagent']) {
      expect(skill).toContain(section);
    }
    expect(skill).toContain('C:\\wmux\\cli-bin/wmux" ping');
  });

  it('keeps the stub short and still checkable by a session outside wmux (#152, #158)', () => {
    const stub = buildContextStub('C:\\wmux\\cli-bin', 'C:\\home\\.claude\\skills\\wmux\\SKILL.md');
    expect(stub.split('\n').length).toBeLessThan(25);
    expect(stub).toContain('wmux ping');
    expect(stub).toContain('"C:\\wmux\\cli-bin/wmux" ping');
    expect(stub).toMatch(/ignore this section/i);
    expect(stub).not.toMatch(/You are running inside wmux/);
    // A reader that loads CLAUDE.md but not skills still has a way in.
    expect(stub).toContain('C:\\home\\.claude\\skills\\wmux\\SKILL.md');
    expect(stub.startsWith('<!-- wmux:start')).toBe(true);
    expect(stub.trimEnd().endsWith('<!-- wmux:end -->')).toBe(true);
  });

  describe('on disk', () => {
    let tmp: string;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wmux-skill-'));
      saved = { USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME };
      process.env.USERPROFILE = tmp;
      process.env.HOME = tmp;
      expect(os.homedir()).toBe(tmp);
    });

    afterEach(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it('writes the skill and only the stub into CLAUDE.md, keeping the user\'s text', () => {
      fs.mkdirSync(path.dirname(getClaudeMdPath()), { recursive: true });
      fs.writeFileSync(getClaudeMdPath(), '# Mine\n\nkeep me\n');
      ensureClaudeContext();
      const md = fs.readFileSync(getClaudeMdPath(), 'utf-8');
      expect(md).toContain('keep me');
      expect(md).toContain(getClaudeSkillPath());
      expect(md).not.toContain('## Browser');
      expect(fs.readFileSync(getClaudeSkillPath(), 'utf-8')).toContain('## Browser');
    });

    it('replaces the old inline block with the stub, and is a fixed point', () => {
      fs.mkdirSync(path.dirname(getClaudeMdPath()), { recursive: true });
      fs.writeFileSync(getClaudeMdPath(), `# Mine\n\n${block}`);
      ensureClaudeContext();
      const once = fs.readFileSync(getClaudeMdPath(), 'utf-8');
      expect(once).not.toContain('## Browser');
      expect(once.match(/<!-- wmux:start/g)).toHaveLength(1);
      ensureClaudeContext();
      expect(fs.readFileSync(getClaudeMdPath(), 'utf-8')).toBe(once);
    });

    it('never overwrites a user skill of the same name, and keeps the full block inline then', () => {
      const theirs = '---\nname: wmux\ndescription: my notes\n---\n\nmine\n';
      fs.mkdirSync(path.dirname(getClaudeSkillPath()), { recursive: true });
      fs.writeFileSync(getClaudeSkillPath(), theirs);
      ensureClaudeContext();
      expect(fs.readFileSync(getClaudeSkillPath(), 'utf-8')).toBe(theirs);
      expect(fs.readFileSync(getClaudeMdPath(), 'utf-8')).toContain('## Browser');
      removeClaudeContext();
      expect(fs.readFileSync(getClaudeSkillPath(), 'utf-8')).toBe(theirs);
    });

    it('removal takes back the skill and its folder along with the stub', () => {
      ensureClaudeContext();
      expect(fs.existsSync(getClaudeSkillPath())).toBe(true);
      removeClaudeContext();
      expect(fs.existsSync(getClaudeSkillPath())).toBe(false);
      expect(fs.existsSync(path.dirname(getClaudeSkillPath()))).toBe(false);
      expect(fs.existsSync(getClaudeMdPath())).toBe(false);
    });
  });
});
