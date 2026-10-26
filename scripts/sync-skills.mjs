#!/usr/bin/env node
/**
 * Write `.claude/skills/` as a copy of `.agents/skills/` (#368).
 *
 * `.agents/skills/` is the one source for repo skills, and Codex reads it
 * there. Claude Code reads only `.claude/skills/`, so this copies each skill
 * across. It is a committed copy rather than a symlink because Git for Windows
 * checks a symlink out as a one-line text file unless `core.symlinks` is on,
 * and Claude Code then finds no skills without saying so.
 * `tests/unit/agent-guidance.test.ts` fails whenever the two trees differ.
 *
 * A directory in `.claude/skills/` with no source is reported and left alone,
 * never deleted: it may be somebody's own skill, and the test names it anyway.
 */
import { cpSync, existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, '.agents', 'skills');
const copy = path.join(root, '.claude', 'skills');

if (!existsSync(source)) {
  console.error(`sync-skills: ${path.relative(root, source)} does not exist`);
  process.exit(1);
}

const skills = readdirSync(source, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
for (const skill of skills) {
  const target = path.join(copy, skill);
  rmSync(target, { recursive: true, force: true });
  cpSync(path.join(source, skill), target, { recursive: true });
}

const orphans = existsSync(copy) ? readdirSync(copy).filter((name) => !skills.includes(name)) : [];
for (const orphan of orphans) {
  console.warn(`sync-skills: .claude/skills/${orphan} has no source in .agents/skills/ and was left in place`);
}
console.log(`sync-skills: copied ${skills.length} skill(s) to ${path.relative(root, copy)}`);
