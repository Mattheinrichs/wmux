/**
 * Putting a terminal back into a state a human can use, after the application
 * that changed it died without changing it back (issue #175).
 *
 * ## What actually breaks
 *
 * A TUI negotiates a pile of DEC private modes on startup — alternate screen,
 * mouse tracking, bracketed paste, application cursor keys — and unwinds them
 * on exit. When it is killed instead of exiting (`code -1`, a panic, a reaped
 * agent), nobody unwinds them, and the modes belong to the *terminal*, not to
 * the dead process. So they survive it.
 *
 * The symptom that gets reported is "I can't copy": `?1002`/`?1003` tracking
 * makes xterm forward mousedown to the application instead of starting a
 * selection, and the application is gone, so the drag goes nowhere. Left on the
 * alternate buffer, the scrollback the user wants to copy is not even reachable.
 * `?25l` leaves no cursor, `?1l` turns arrow keys into `ESC O A` that PSReadLine
 * renders as garbage, and a stuck SGR paints the shell's output in the dead
 * app's colours.
 *
 * wmux already tracked the mouse modes for its own purposes (see
 * ./mouse-modes) and cleared that map on exit — but clearing wmux's *record* of
 * the modes never told xterm to leave them. That is the gap this closes.
 *
 * ## Why not `ESC c` (RIS)
 *
 * A full reset is the obvious answer and the wrong one: in xterm.js it clears
 * the buffer and the scrollback. The whole point of recovering the pane is to
 * read and copy what is in it. So this resets modes and nothing else — no cell
 * in the buffer is touched.
 *
 * ## Two sequences that move the cursor, and how they are handled
 *
 * Both were verified against xterm.js's `InputHandler`, not assumed:
 *
 * - `ESC[?1049l` ends with `restoreCursor()`, which reads `savedX`/`savedY` and
 *   falls back to `0`. On a terminal that never entered the alternate buffer
 *   nothing ever saved those, so the sequence would silently home the cursor and
 *   the shell's next line would overwrite row 1. Hence it is emitted only when
 *   the terminal is actually on the alternate buffer.
 *
 * - `ESC[r` (DECSTBM reset) calls `_setCursor(0, 0)` unconditionally. It is
 *   wrapped in DECSC/DECRC so the cursor lands back where it was. The restore
 *   also brings back the saved colours, which is why `ESC[0m` comes *after* the
 *   sandwich rather than before it — otherwise DECRC would reinstate the very
 *   attributes we are clearing.
 *
 * DECSC clobbers whatever the shell had saved in that slot. That is a real but
 * cheap cost: shells re-save around every prompt, and a pane the user has asked
 * to force-reset has already lost more than one cursor bookmark.
 *
 * ## The alternate screen is not a mode a live program re-asserts (#347)
 *
 * Most of the modes above are cheap to drop under a running program: it puts
 * back the ones it wants on its next redraw, or the user notices and restarts
 * it. `?1049` is different. A fullscreen program (Claude Code, opencode, vim)
 * sends `?1049h` once, at startup, and never again — so a manual reset that
 * left the alternate buffer under it sent every later frame into the shell's
 * scrollback, and its exit `?1049l` found no alternate screen to leave and only
 * homed the cursor, printing the prompt over the stale frame. The PTY-exit path
 * always leaves (there is no program); the manual reset leaves only when the
 * shell has positively said it is back at its prompt. An UNKNOWN state keeps the
 * alternate screen: a program started before the shell's first prompt (a
 * restored `claude --resume`, run by the PowerShell integration during init)
 * has never been announced as running, and is exactly the case to protect.
 */

import type { Terminal } from '@xterm/xterm';
import type { ShellState } from './surface-shell-state';

/**
 * Mode resets that are safe to send in any state, in the order they are sent.
 *
 * Grouped by what they undo rather than by numeric order, because the reason a
 * mode is in this list is the only thing that makes it reviewable.
 */
const SAFE_RESETS = [
  // Mouse tracking protocols — the "I can't select text" half of #175.
  '\x1b[?9l', '\x1b[?1000l', '\x1b[?1001l', '\x1b[?1002l', '\x1b[?1003l',
  // Mouse coordinate encodings. Harmless with tracking off, but leaving them
  // set means the next application inherits an encoding it never asked for —
  // the #164 failure, arrived at from the other direction.
  '\x1b[?1005l', '\x1b[?1006l', '\x1b[?1015l', '\x1b[?1016l',
  // Focus reporting: otherwise every alt-tab writes ESC[I / ESC[O at the prompt.
  '\x1b[?1004l',
  // Bracketed paste: a paste into a shell that is not expecting the wrapper
  // shows literal `200~` before the text.
  '\x1b[?2004l',
  // DECCKM off — arrow keys back to ESC[A rather than ESC O A.
  '\x1b[?1l',
  // Autowrap on. TUIs routinely turn it off; a shell without it truncates.
  '\x1b[?7h',
  // Cursor visible.
  '\x1b[?25h',
].join('');

/** Scroll region reset, cursor-preserving. See the DECSC/DECRC note above. */
const SCROLL_REGION_RESET = '\x1b7\x1b[r\x1b8';

/** Insert/replace mode back to replace, then default attributes. */
const TRAILING_RESETS = '\x1b[4l\x1b[0m';

/**
 * The sequence that would reset `terminal`, given the buffer it is currently on.
 *
 * Exported separately from {@link resetTerminalModes} so it can be asserted on
 * in tests without standing up a real xterm instance.
 */
export function terminalResetSequence(onAlternateBuffer: boolean): string {
  // Leaving the alternate buffer first: everything after it must land on the
  // buffer the user is going to be looking at.
  return (onAlternateBuffer ? '\x1b[?1049l' : '')
    + SAFE_RESETS
    + SCROLL_REGION_RESET
    + TRAILING_RESETS;
}

/**
 * May a manual reset leave the alternate screen? Only when the pane's shell has
 * reported it is back at its prompt — then whatever entered the alternate
 * screen is gone (#175). `running` means it is still drawing there, and no
 * report at all means wmux cannot tell (#347), so both keep it.
 */
export function shellOwnsScreen(shellState: ShellState | undefined): boolean {
  return shellState === 'idle' || shellState === 'interrupted';
}

export interface ResetOptions {
  /**
   * Stay on the alternate buffer even if the terminal is on it, because a
   * program may still be drawing there (#347). Every other mode is still reset.
   */
  keepAlternateScreen?: boolean;
}

/**
 * Put `terminal` back into a usable state.
 *
 * Writes into the terminal, never to the PTY — this changes what wmux's own
 * emulator believes, and must not be visible to whatever is still running on
 * the other end. A live application's next redraw re-asserts most of the modes
 * it wants; the alternate screen is the exception, see `keepAlternateScreen`.
 */
export function resetTerminalModes(terminal: Terminal, options: ResetOptions = {}): void {
  let onAlternateBuffer = false;
  try {
    onAlternateBuffer = terminal.buffer.active.type === 'alternate';
  } catch {
    // Buffer not readable (disposed, or a stub in tests) — the conditional
    // sequence is the only one that could misfire, so skipping it is the safe
    // branch rather than a degraded one.
  }
  try {
    terminal.write(terminalResetSequence(onAlternateBuffer && !options.keepAlternateScreen));
  } catch {
    // A disposed terminal throws on write. Recovery of a pane that no longer
    // exists is a no-op by definition, not an error worth surfacing.
  }
}
