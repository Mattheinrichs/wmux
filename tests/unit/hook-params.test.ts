import { describe, it, expect } from 'vitest';
import { hookParams } from '../../src/cli/wmux';

/**
 * `wmux hook` is how the OpenCode plugin hands wmux a `UserPromptSubmit`
 * (issue #304), so the flag parser is the seam between the prompt text the
 * user typed and the prompt log that renders it.
 *
 * Deliberately NOT `parseFlagArgs`: that parser refuses a value when it looks
 * like one of its own flags (`"--prompt --tool"` reads as a missing value),
 * and a prompt whose entire text is `--tool` is a prompt, not a malformed
 * argv. The pair loop takes the next slot unconditionally.
 */
describe('wmux hook argv (#304)', () => {
  it('carries the prompt text through to hook.event', () => {
    expect(hookParams(['hook', '--event', 'UserPromptSubmit', '--prompt', 'fix the flaky test']))
      .toEqual({ event: 'UserPromptSubmit', prompt: 'fix the flaky test' });
  });

  it('keeps every flag the plugin already sends', () => {
    expect(hookParams(['hook', '--event', 'PostToolUse', '--tool', 'Bash', '--agent', 'a1']))
      .toEqual({ event: 'PostToolUse', tool: 'Bash', agentId: 'a1' });
  });

  it('takes a prompt whose whole text is one of our own flags', () => {
    expect(hookParams(['hook', '--event', 'UserPromptSubmit', '--prompt', '--tool']))
      .toEqual({ event: 'UserPromptSubmit', prompt: '--tool' });
  });

  it('keeps spaces, quotes and newlines — argv arrives pre-split', () => {
    const text = '  "hi"\nline 2 ';
    expect(hookParams(['hook', '--event', 'UserPromptSubmit', '--prompt', text]).prompt).toBe(text);
  });
});
