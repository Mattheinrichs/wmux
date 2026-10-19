import { describe, it, expect } from 'vitest';
import { hookEventSurface } from '../../src/renderer/utils/prompt-log';

/**
 * One `hook.event`, two producers, two spellings of "which pane" (issue #304).
 *
 * Claude Code's `wmux-hook.js` sends `surfaceId`; the OpenCode plugin goes
 * through `wmux hook`, whose transport stamps the calling pane as `caller`.
 * The prompt log must read both — and main must keep seeing only `surfaceId`
 * for this event, because a v2 opencode `UserPromptSubmit` carries no `Stop`
 * to clear the `runDepth: 1` the declared-state bridge would assign it.
 */
describe('hookEventSurface (#304)', () => {
  it('prefers the explicit surfaceId Claude Code sends', () => {
    expect(hookEventSurface({ surfaceId: 'surf-a', caller: 'surf-b' })).toBe('surf-a');
  });

  it('falls back to the caller shape `wmux hook` stamps', () => {
    expect(hookEventSurface({ caller: 'surf-b' })).toBe('surf-b');
  });

  it('is empty — never a bogus pane — for anything else', () => {
    expect(hookEventSurface({})).toBe('');
    expect(hookEventSurface(null)).toBe('');
    expect(hookEventSurface(undefined)).toBe('');
    expect(hookEventSurface({ surfaceId: 42, caller: 7 })).toBe('');
  });
});
