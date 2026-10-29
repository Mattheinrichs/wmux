import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

import { hookToAgentReport, applyHookToAgentState, hookEventName, resetHookBridge, noteToolEvent, newToolLedger } from '../../src/main/agent-hook-bridge';
import { getAgentState, resetAgentState, reportAgent, noteHumanInput } from '../../src/main/agent-state';
import { SurfaceId } from '../../src/shared/types';

const surf = 'surf-hook-1' as SurfaceId;

beforeEach(() => {
  resetAgentState();
  resetHookBridge();
});

/**
 * Turn context for the pure mapper. Defaults to a mid-turn pane on the 0.48.0
 * hook set, which is what every event other than Notification ignores anyway.
 */
const ctx = (over: Partial<Parameters<typeof hookToAgentReport>[2]> = {}) =>
  ({ known: true, runDepth: 1, turnStartTracked: true, ...over });

describe('hookToAgentReport', () => {
  it('Notification parks the pane on the user and keeps the message as the reason', () => {
    expect(hookToAgentReport('Notification', 'Claude needs your permission to use Bash', ctx()))
      .toEqual({ awaitingHuman: true, reason: 'Claude needs your permission to use Bash' });
  });

  it('the 60s idle nudge after a finished turn is NOT blocked (issue #151)', () => {
    // Same hook, different situation. A prompt can only exist inside a live
    // turn, so depth 0 at Notification time means this is the idle nudge — and
    // "Needs you" on a pane with nothing to answer is how a session that was
    // /clear'd and left alone starts asking for attention a minute later.
    expect(hookToAgentReport('Notification', 'Claude is waiting for your input', ctx({ runDepth: 0 })))
      .toBeNull();
  });

  it('a prompt inside a live turn is still blocked', () => {
    expect(hookToAgentReport('Notification', 'permission to use Bash', ctx({ runDepth: 1 }))?.awaitingHuman)
      .toBe(true);
  });

  it('parks the pane for both when the opening hooks are not installed', () => {
    // A settings.json written before 0.48.0 sits at depth 0 through an entire
    // turn, so the discriminator carries no information — and guessing would
    // fail in the dangerous direction, swallowing a real permission prompt.
    expect(hookToAgentReport('Notification', 'permission to use Bash', ctx({ runDepth: 0, turnStartTracked: false }))?.awaitingHuman)
      .toBe(true);
  });

  it('parks the pane for a surface it holds no record for', () => {
    // Depth 0 by default rather than by observation — what a main process
    // restarted in the middle of someone's turn sees.
    expect(hookToAgentReport('Notification', 'permission to use Bash', ctx({ known: false, runDepth: 0 }))?.awaitingHuman)
      .toBe(true);
  });

  it('PostToolUse asserts a run, idempotently, and leaves the block alone', () => {
    expect(hookToAgentReport('PostToolUse', null, ctx())).toEqual({ runDepth: 1 });
  });

  it('SubagentStop keeps the parent turn running (issue #151)', () => {
    // Not a decrement: subagents share the parent's surface id, so the first one
    // to finish used to drain the refcount and report the pane idle while the
    // parent and its siblings were still working.
    expect(hookToAgentReport('SubagentStop', null, ctx())).toEqual({ runDepth: 1 });
  });

  it('SubagentStop sustains a live turn but never starts one (issue #151)', () => {
    // Measured, twice, on two panes: Claude Code fires SubagentStop 1.8-2.2s
    // AFTER the parent's Stop, not before it. Asserting depth 1 unconditionally
    // therefore resurrects the run Stop had just ended — and with a strictly
    // newer hookAt, so the wall-clock ordering gate waves it through.
    expect(hookToAgentReport('SubagentStop', null, ctx({ runDepth: 0 }))).toBeNull();
    expect(hookToAgentReport('SubagentStop', null, ctx({ known: false, runDepth: 0 }))).toBeNull();
  });

  it('Stop is decisive: nothing running, nothing waiting', () => {
    expect(hookToAgentReport('Stop', null, ctx())).toEqual({ awaitingHuman: false, runDepth: 0 });
  });

  it('SessionStart registers the pane as an idle session (issue #151)', () => {
    expect(hookToAgentReport('SessionStart', null, ctx())).toEqual({ awaitingHuman: false, runDepth: 0 });
  });

  it('UserPromptSubmit starts the turn and ends the wait (issue #151)', () => {
    expect(hookToAgentReport('UserPromptSubmit', null, ctx())).toEqual({ awaitingHuman: false, runDepth: 1 });
  });

  it('PreToolUse asserts the run before the tool, not after it (issue #151)', () => {
    // No `awaitingHuman`: a tool starting cannot mean a question was answered,
    // and under a background shell or parallel subagents it routinely is not.
    expect(hookToAgentReport('PreToolUse', null, ctx())).toEqual({ runDepth: 1 });
  });
});

describe('hookEventName', () => {
  it('reads the event when the payload names one', () => {
    expect(hookEventName({ event: 'Stop' })).toBe('Stop');
  });

  it('resolves a bare tool payload to PostToolUse (issue #151)', () => {
    // The per-tool PostToolUse entries invoke the hook helper by bare tool
    // name, so they arrive with a `tool` and no `event` at all. Gating on
    // `params.event` dropped every one of them and made the PostToolUse case
    // unreachable.
    expect(hookEventName({ tool: 'Bash' })).toBe('PostToolUse');
  });

  it('ignores an event outside the model', () => {
    expect(hookEventName({ event: 'PreCompact' })).toBeNull();
  });

  it('ignores a payload that names neither', () => {
    expect(hookEventName({})).toBeNull();
    expect(hookEventName(null)).toBeNull();
  });
});

describe('applyHookToAgentState', () => {
  it('ignores hook events that are not part of the model', () => {
    applyHookToAgentState(surf, 'PreCompact', null);
    expect(getAgentState(surf)).toBeUndefined();
  });

  it('a fresh session reads idle, not unknown (issue #151)', () => {
    // The pane must become a KNOWN session immediately. Left unknown, the
    // sidebar falls back to shell state — and `claude` is a foreground command,
    // so a brand-new session that has done nothing showed "Running".
    applyHookToAgentState(surf, 'SessionStart', null);
    expect(getAgentState(surf)?.state).toBe('idle');
  });

  it('the pane is working from the moment the human hits Enter (issue #151)', () => {
    // The gap this closes: before UserPromptSubmit, nothing said a turn had
    // begun until the FIRST TOOL FINISHED. A turn that thinks for a minute, or
    // runs one long command, read as idle for all of it.
    applyHookToAgentState(surf, 'SessionStart', null);
    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    expect(getAgentState(surf)?.state).toBe('working');
  });

  it('replying to a blocked pane un-blocks it without waiting for a tool (issue #151)', () => {
    applyHookToAgentState(surf, 'Notification', 'Claude needs your permission to use Bash');
    expect(getAgentState(surf)?.state).toBe('blocked');

    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    expect(getAgentState(surf)).toMatchObject({ state: 'working', blockedReason: null });
  });

  it('a long tool reports working while it runs, not once it ends (issue #151)', () => {
    applyHookToAgentState(surf, 'PreToolUse', null);
    expect(getAgentState(surf)?.state).toBe('working');
  });

  it('SessionEnd releases the pane rather than pinning it idle (issue #151)', () => {
    // Forgotten, not set to idle: a declared `idle` outranks the sidebar's own
    // inference, so an ended session would freeze the pane's reading forever.
    applyHookToAgentState(surf, 'SessionStart', null);
    applyHookToAgentState(surf, 'SessionEnd', null);
    expect(getAgentState(surf)).toBeUndefined();
  });

  it('orders racing hook processes by fire time, not arrival (issue #151)', () => {
    // PostToolUse fired first but its node process lost the race to the pipe.
    // Applied in arrival order it would re-assert a run that Stop had ended, and
    // the pane would claim `working` for the full 15-minute trust window.
    applyHookToAgentState(surf, 'Stop', null, 2000);
    applyHookToAgentState(surf, 'PostToolUse', null, 1000);
    expect(getAgentState(surf)?.state).toBe('idle');
  });

  it('still applies hook events that arrive in order', () => {
    applyHookToAgentState(surf, 'Stop', null, 1000);
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 2000);
    expect(getAgentState(surf)?.state).toBe('working');
  });

  it('drives a full turn: tool use → permission prompt → answered → done', () => {
    applyHookToAgentState(surf, 'PostToolUse', null);
    expect(getAgentState(surf)?.state).toBe('working');

    applyHookToAgentState(surf, 'Notification', 'permission to use Bash');
    expect(getAgentState(surf)).toMatchObject({ state: 'blocked', blockedReason: 'permission to use Bash' });

    // The user replied. A tool running is NOT what proves that — see the
    // background-work tests below — so the block ends on the turn ending.
    applyHookToAgentState(surf, 'Stop', null);
    expect(getAgentState(surf)).toMatchObject({ state: 'idle', blockedReason: null });
  });

  it('background work does not retract a live question (issue #151)', () => {
    // The reported case: the agent starts a background shell, then asks a
    // question with options. The background command's own hooks carry the SAME
    // WMUX_SURFACE_ID, so its tool lifecycle lands on the pane that is asking.
    // Every one of these used to assert awaitingHuman: false and snap the pane
    // back to "Running" with the question still on screen.
    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    applyHookToAgentState(surf, 'Notification', 'Claude needs your permission');
    expect(getAgentState(surf)?.state).toBe('blocked');

    for (const event of ['PreToolUse', 'PostToolUse', 'SubagentStop'] as const) {
      applyHookToAgentState(surf, event, null);
      expect(getAgentState(surf)).toMatchObject({ state: 'blocked', blockedReason: 'Claude needs your permission' });
    }

    // And the run is still genuinely in flight underneath — `blocked` outranks
    // it rather than replacing it, so answering still leaves a live turn.
    expect(getAgentState(surf)?.runDepth).toBe(1);
    applyHookToAgentState(surf, 'Stop', null);
    expect(getAgentState(surf)?.state).toBe('idle');
  });

  it('the human replying is what ends the wait, not a tool (issue #151)', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    applyHookToAgentState(surf, 'Notification', 'permission to use Bash');
    expect(getAgentState(surf)?.state).toBe('blocked');

    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    expect(getAgentState(surf)).toMatchObject({ state: 'working', blockedReason: null });
  });

  it('hundreds of tool calls do not inflate the run depth', () => {
    for (let i = 0; i < 300; i++) applyHookToAgentState(surf, 'PostToolUse', null);
    expect(getAgentState(surf)?.runDepth).toBe(1);
  });

  it('Stop clears a pane that was left blocked', () => {
    // The backstop property: even if the un-block event is missed, ending the
    // turn must not leave a ghost "needs you" behind.
    applyHookToAgentState(surf, 'Notification', 'waiting');
    applyHookToAgentState(surf, 'Stop', null);
    expect(getAgentState(surf)).toMatchObject({ state: 'idle', blockedReason: null });
  });

  it('the idle nudge does not resurrect a finished turn (issue #151)', () => {
    // The sequence that produced the report: a session is /clear'd and left
    // alone. /clear wipes the transcript but not Claude Code's idle timer, so
    // 60s after the Stop the nudge lands on an empty conversation.
    applyHookToAgentState(surf, 'SessionStart', null);
    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    applyHookToAgentState(surf, 'Stop', null);
    expect(getAgentState(surf)?.state).toBe('idle');

    applyHookToAgentState(surf, 'Notification', 'Claude is waiting for your input');
    expect(getAgentState(surf)).toMatchObject({ state: 'idle', blockedReason: null });
  });

  it('but a permission prompt mid-turn still parks the pane', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    applyHookToAgentState(surf, 'Notification', 'permission to use Bash');
    expect(getAgentState(surf)).toMatchObject({ state: 'blocked', blockedReason: 'permission to use Bash' });
  });

  it('a subagent finishing does not end the outer turn (issue #151)', () => {
    // Three subagents on one surface. Every one of them finishing must leave the
    // pane working — only the parent's Stop ends the turn.
    applyHookToAgentState(surf, 'UserPromptSubmit', null);
    for (let i = 0; i < 3; i++) {
      applyHookToAgentState(surf, 'PostToolUse', null);
      applyHookToAgentState(surf, 'SubagentStop', null);
      expect(getAgentState(surf)?.state).toBe('working');
    }
    applyHookToAgentState(surf, 'Stop', null);
    expect(getAgentState(surf)?.state).toBe('idle');
  });

  it('a SubagentStop trailing the parent Stop does not resurrect the turn (issue #151)', () => {
    // The real wire order, with the real stamps: Stop at T, SubagentStop at
    // T+2s. The later stamp is what makes this bite — acceptHookAt orders by
    // hookAt, so the trailing report is newer and cannot be dropped as a replay.
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'PostToolUse', null, 2000);
    applyHookToAgentState(surf, 'Stop', null, 3000);
    expect(getAgentState(surf)?.state).toBe('idle');

    applyHookToAgentState(surf, 'SubagentStop', null, 5000);
    expect(getAgentState(surf)?.state).toBe('idle');

    // And the 60s idle nudge that follows must still read as a nudge, not as a
    // prompt — the resurrection defeated that gate too.
    applyHookToAgentState(surf, 'Notification', 'Claude is waiting for your input', 65000);
    expect(getAgentState(surf)?.state).toBe('idle');
  });
});

describe('Notification kinds (issue #253)', () => {
  it('idle_prompt never blocks, even mid-turn by the depth heuristic', () => {
    // Depth 1 is exactly what a background subagent leaves behind after the
    // parent's Stop — the case the depth-only rule read as a prompt.
    expect(hookToAgentReport('Notification', 'Claude is waiting for your input', ctx({ runDepth: 1, notificationType: 'idle_prompt' })))
      .toBeNull();
  });

  it('auth_success is informational and does not block', () => {
    expect(hookToAgentReport('Notification', 'Authentication successful', ctx({ notificationType: 'auth_success' })))
      .toBeNull();
  });

  it('a Grok background task finishing does not block, even mid-turn', () => {
    expect(hookToAgentReport('Notification', 'Background task completed: task-1', ctx({ runDepth: 1, notificationType: 'task_complete' })))
      .toBeNull();
  });

  it('permission_prompt and elicitation_dialog always block', () => {
    for (const notificationType of ['permission_prompt', 'elicitation_dialog']) {
      // Even where the depth heuristic alone would have called it a nudge:
      // the payload's own label outranks the inference.
      expect(hookToAgentReport('Notification', 'Claude needs your permission to use Bash', ctx({ runDepth: 0, notificationType })))
        .toEqual({ awaitingHuman: true, reason: 'Claude needs your permission to use Bash' });
    }
  });

  it('an unrecognised type blocks rather than going silent', () => {
    expect(hookToAgentReport('Notification', 'something new', ctx({ runDepth: 0, notificationType: 'future_prompt' }))?.awaitingHuman)
      .toBe(true);
  });

  it('legacy payload: the exact idle text does not block, even at depth 1 or before tracking', () => {
    for (const c of [ctx({ runDepth: 1 }), ctx({ runDepth: 0, turnStartTracked: false }), ctx({ known: false, runDepth: 0 })]) {
      expect(hookToAgentReport('Notification', 'Claude is waiting for your input', c)).toBeNull();
    }
  });

  it('legacy payload: a permission message still blocks mid-turn', () => {
    expect(hookToAgentReport('Notification', 'Claude needs your permission to use Bash', ctx({ runDepth: 1 }))?.awaitingHuman)
      .toBe(true);
  });

  it('a background subagent finishing after Stop does not end in "Needs you"', () => {
    // The reported sequence: the parent's turn ends with a background agent
    // still running ("Waiting for 1 background agent to finish"), the agent's
    // own tool hooks keep landing on the parent's surface, it finishes, and a
    // minute later Claude Code posts its idle reminder.
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'PreToolUse', null, 2000);
    applyHookToAgentState(surf, 'Stop', null, 3000);
    applyHookToAgentState(surf, 'PreToolUse', null, 4000);
    applyHookToAgentState(surf, 'PostToolUse', null, 5000);
    applyHookToAgentState(surf, 'SubagentStop', null, 6000);
    applyHookToAgentState(surf, 'Notification', 'Claude is waiting for your input', 66000, 'idle_prompt');
    expect(getAgentState(surf)?.state).not.toBe('blocked');
    expect(getAgentState(surf)?.blockedReason ?? null).toBeNull();
  });

  it('the same sequence without a notification_type (older Claude Code) is not blocked either', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'Stop', null, 3000);
    applyHookToAgentState(surf, 'PostToolUse', null, 5000);
    applyHookToAgentState(surf, 'SubagentStop', null, 6000);
    applyHookToAgentState(surf, 'Notification', 'Claude is waiting for your input', 66000);
    expect(getAgentState(surf)?.state).not.toBe('blocked');
  });

  it('an idle reminder does not retract a block that is really there', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'Notification', 'Claude needs your permission to use Bash', 2000, 'permission_prompt');
    applyHookToAgentState(surf, 'Notification', 'Claude is waiting for your input', 62000, 'idle_prompt');
    expect(getAgentState(surf)).toMatchObject({ state: 'blocked', blockedReason: 'Claude needs your permission to use Bash' });
  });
});

describe('a permission prompt the agent moved past (issue #399)', () => {
  const PERMISSION = 'Claude needs your permission to use Bash';
  const main = (toolUseId: string) => ({ toolUseId });
  const sub = (toolUseId: string) => ({ toolUseId, agentId: 'agent-1' });

  /** A turn whose main thread starts `toolu_A`, which then asks for permission. */
  function promptOnA(): void {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'PreToolUse', null, 2000, null, main('toolu_A'));
    applyHookToAgentState(surf, 'Notification', PERMISSION, 3000, 'permission_prompt');
    expect(getAgentState(surf)).toMatchObject({ state: 'blocked', blockedReason: PERMISSION });
  }

  it('the approved tool finishing clears the block, with no keystroke (auto mode)', () => {
    promptOnA();
    applyHookToAgentState(surf, 'PostToolUse', null, 90_000, null, main('toolu_A'));
    expect(getAgentState(surf)).toMatchObject({ state: 'working', blockedReason: null });
  });

  it('the main thread starting its next tool clears the block', () => {
    promptOnA();
    applyHookToAgentState(surf, 'PreToolUse', null, 4000, null, main('toolu_B'));
    expect(getAgentState(surf)).toMatchObject({ state: 'working', blockedReason: null });
  });

  it('a subagent tool event does not clear it (the #151 rule stands)', () => {
    promptOnA();
    applyHookToAgentState(surf, 'PreToolUse', null, 4000, null, sub('toolu_S'));
    applyHookToAgentState(surf, 'PostToolUse', null, 5000, null, sub('toolu_S'));
    expect(getAgentState(surf)?.state).toBe('blocked');
  });

  it('a tool event without a tool_use_id does not clear it', () => {
    promptOnA();
    applyHookToAgentState(surf, 'PreToolUse', null, 4000);
    applyHookToAgentState(surf, 'PostToolUse', null, 5000);
    expect(getAgentState(surf)?.state).toBe('blocked');
  });

  it('a sibling call in the same batch finishing does not clear it', () => {
    // Read and Bash started together; Bash asks. Read finishing proves nothing
    // about Bash, so the block holds until Bash has finished too.
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'PreToolUse', null, 2000, null, main('toolu_Read'));
    applyHookToAgentState(surf, 'PreToolUse', null, 2001, null, main('toolu_Bash'));
    applyHookToAgentState(surf, 'Notification', PERMISSION, 3000, 'permission_prompt');

    applyHookToAgentState(surf, 'PostToolUse', null, 4000, null, main('toolu_Read'));
    expect(getAgentState(surf)?.state).toBe('blocked');

    applyHookToAgentState(surf, 'PostToolUse', null, 9000, null, main('toolu_Bash'));
    expect(getAgentState(surf)?.state).toBe('working');
  });

  it('a start that fired before the prompt but arrived after it does not clear it', () => {
    // The PreToolUse hook is async; its process can lose the race to the
    // synchronous Notification. Its stamp says it was already in flight.
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'Notification', PERMISSION, 3000, 'permission_prompt');
    applyHookToAgentState(surf, 'PreToolUse', null, 2000, null, main('toolu_A'));
    expect(getAgentState(surf)?.state).toBe('blocked');

    // And it is the call the prompt waits on: its finish is the evidence.
    applyHookToAgentState(surf, 'PostToolUse', null, 8000, null, main('toolu_A'));
    expect(getAgentState(surf)?.state).toBe('working');
  });

  it('a call that finished before the prompt does not clear it', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'PreToolUse', null, 2000, null, main('toolu_A'));
    applyHookToAgentState(surf, 'Notification', PERMISSION, 3000, 'permission_prompt');
    applyHookToAgentState(surf, 'PostToolUse', null, 2500, null, main('toolu_A'));
    expect(getAgentState(surf)?.state).toBe('blocked');
  });

  it('the clear stands even when its report lost the wall-clock gate', () => {
    promptOnA();
    // A newer hook already landed (a subagent's), so the main thread's
    // PostToolUse is older than lastHookAt and its report is dropped. The
    // evidence was ordered against the block, not against that report.
    applyHookToAgentState(surf, 'PostToolUse', null, 9000, null, sub('toolu_S'));
    applyHookToAgentState(surf, 'PostToolUse', null, 8000, null, main('toolu_A'));
    expect(getAgentState(surf)?.state).toBe('working');
  });

  it('never retracts a block the agent declared itself', () => {
    // `wmux report-agent --blocked`, run by the agent through its own Bash tool:
    // that call's PostToolUse lands after the declaration and must not undo it.
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    applyHookToAgentState(surf, 'PreToolUse', null, 2000, null, main('toolu_A'));
    reportAgent(surf, { awaitingHuman: true, reason: 'Which database?' });
    applyHookToAgentState(surf, 'PostToolUse', null, 3000, null, main('toolu_A'));
    applyHookToAgentState(surf, 'PreToolUse', null, 4000, null, main('toolu_B'));
    expect(getAgentState(surf)).toMatchObject({ state: 'blocked', blockedReason: 'Which database?' });
  });

  it('a hook re-report does not downgrade a declared block', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 1000);
    reportAgent(surf, { awaitingHuman: true, reason: 'Which database?' });
    applyHookToAgentState(surf, 'Notification', PERMISSION, 3000, 'permission_prompt');
    applyHookToAgentState(surf, 'PreToolUse', null, 4000, null, main('toolu_B'));
    expect(getAgentState(surf)?.state).toBe('blocked');
  });

  it('a turn boundary forgets the calls of the turn before', () => {
    promptOnA();
    applyHookToAgentState(surf, 'Stop', null, 5000);
    applyHookToAgentState(surf, 'UserPromptSubmit', null, 6000);
    applyHookToAgentState(surf, 'Notification', PERMISSION, 7000, 'permission_prompt');
    // toolu_A belonged to the last turn; its late finish is no evidence now.
    applyHookToAgentState(surf, 'PostToolUse', null, 8000, null, main('toolu_A'));
    expect(getAgentState(surf)?.state).toBe('blocked');
  });
});

describe('a permission prompt answered before its hook arrived (issue #399)', () => {
  it('a keystroke after the Notification fired keeps its late block from landing', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, Date.now() - 5000);
    const firedAt = Date.now() - 1000;
    // The user pressed Enter on the prompt while the hook process was booting.
    expect(noteHumanInput(surf, '\r')).toBe(false);
    applyHookToAgentState(surf, 'Notification', 'Claude needs your permission to use Bash', firedAt, 'permission_prompt');
    expect(getAgentState(surf)?.state).toBe('working');
  });

  it('a keystroke from before the Notification fired does not swallow it', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, Date.now() - 5000);
    noteHumanInput(surf, 'x');
    applyHookToAgentState(surf, 'Notification', 'Claude needs your permission to use Bash', Date.now() + 1000, 'permission_prompt');
    expect(getAgentState(surf)?.state).toBe('blocked');
  });

  it('navigation keys are not an answer', () => {
    applyHookToAgentState(surf, 'UserPromptSubmit', null, Date.now() - 5000);
    const firedAt = Date.now() - 1000;
    noteHumanInput(surf, '\x1b[A');
    applyHookToAgentState(surf, 'Notification', 'Claude needs your permission to use Bash', firedAt, 'permission_prompt');
    expect(getAgentState(surf)?.state).toBe('blocked');
  });

  it('only a hook block is subject to it, not one the agent declares', () => {
    reportAgent(surf, { runDepth: 1 });
    noteHumanInput(surf, '\r');
    reportAgent(surf, { awaitingHuman: true, reason: 'Which database?' });
    expect(getAgentState(surf)?.state).toBe('blocked');
  });
});

describe('noteToolEvent', () => {
  it('reports nothing while no block is watched', () => {
    const ledger = newToolLedger();
    expect(noteToolEvent(ledger, 'PreToolUse', 'a', 1)).toBe(false);
    expect(noteToolEvent(ledger, 'PostToolUse', 'a', 2)).toBe(false);
    expect(ledger.inFlight.size).toBe(0);
  });

  it('a start that loses the race to its own finish is not left in flight', () => {
    const ledger = newToolLedger();
    noteToolEvent(ledger, 'PostToolUse', 'a', 2);
    noteToolEvent(ledger, 'PreToolUse', 'a', 1);
    expect(ledger.inFlight.has('a')).toBe(false);
  });

  it('with nothing in flight at the prompt, only a new start is evidence', () => {
    const ledger = newToolLedger();
    ledger.block = { at: 10, tools: new Set() };
    expect(noteToolEvent(ledger, 'PostToolUse', 'x', 20)).toBe(false);
    expect(noteToolEvent(ledger, 'PreToolUse', 'y', 21)).toBe(true);
  });
});
