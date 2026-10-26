# Windows Keep-Awake for Coding Agents — Design

**Date:** 2026-10-25 · **Status:** Draft / Proposed · **Owner:** wmux Windows agent visibility

## 1. Intent & Problem

Coding agents (Claude Code, Codex, OpenCode, omp, Antigravity CLI) frequently run long-running autonomous workflows: multi-file refactorings, test suite executions, dependency updates, and multi-turn debugging. These runs commonly take 10 to 60+ minutes.

On Windows, default power policies turn off displays and suspend the system after 10–30 minutes of inactivity. When Windows sleeps mid-task:
- PTY sessions and spawned child processes freeze or terminate.
- Network connections drop, causing API calls, git pushes, or package downloads to fail.
- Agents are left in corrupted or un-resumable states.

Third-party utilities like Microsoft PowerToys Awake or Caffeine solve this manually, but require the developer to remember to turn them on before walking away and turn them off when done. If forgotten, either the PC sleeps prematurely or stays running at full power all night.

Because wmux already tracks agent run state across all workspace panes (`working`, `blocked`, `idle`), wmux can provide **passive, automatic sleep prevention**: keeping Windows awake when and only while agents are actively executing.

---

## 2. Approach: Dynamic Agent-Aware Keep Awake

wmux implements an **Agent-Aware Awake Manager** in the Electron main process, backed by Electron's native `powerSaveBlocker` (which calls Windows' kernel `SetThreadExecutionState`).

### Operating Modes
- **`smart` (Default):** wmux automatically acquires a sleep blocker whenever at least one agent is in the `working` state. As soon as all agents finish (`idle`), are killed, or park on human questions (`blocked`), the blocker is released so Windows power management resumes.
- **`always`:** Forces continuous sleep inhibition regardless of agent activity while wmux is running.
- **`off`:** Disables all sleep blocking; default Windows power rules apply.

### Sleep Assertion Levels
- **System Sleep (`prevent-app-suspension`, default):** Keeps CPU and background tasks running while allowing monitors to turn off to conserve power.
- **Display & System Sleep (`prevent-display-sleep`, opt-in):** Keeps both system and display awake, preventing Windows lock screen (vital for workflows using password-manager-backed SSH keys like 1Password SSH Agent, which lock when the screen locks).

---

## 3. Architecture & Components

```
┌────────────────────────────────────────────────────────┐
│ Main Process                                          │
│                                                        │
│  agent-state.ts                                        │
│    │ onAgentStateBroadcast()                           │
│    ▼                                                   │
│  awake-manager.ts ──► powerSaveBlocker (Windows API)   │
│    │                                                   │
│    ▼ IPC: awake:state-changed                          │
└────┼───────────────────────────────────────────────────┘
     │
┌────┼───────────────────────────────────────────────────┐
│ Renderer Process                                       │
│    ▼                                                   │
│  useStore (settings / awake slice)                     │
│    │                                                   │
│    ├──► KeepAwakeMenu.tsx (titlebar quick menu)        │
│    └──► WorkspaceSettings.tsx (Preferences & Policy)   │
└────────────────────────────────────────────────────────┘
```

### A. Main Process: `src/main/awake-manager.ts`
- **Class:** `AwakeManager`
- Subscribes to `onAgentStateBroadcast` from `agent-state.ts`.
- Evaluates active agent status:
  ```typescript
  const hasWorkingAgents = listAgentStates().some((s) => s.state === 'working');
  ```
- State machine handles mode (`smart`, `always`, `off`) and assertion type (`prevent-app-suspension` vs `prevent-display-sleep`).
- Manages `blockerId = powerSaveBlocker.start(...)` and `powerSaveBlocker.stop(blockerId)`.
- Broadcasts current status to all windows via `IPC_CHANNELS.AWAKE_STATE_CHANGED`.
- Cleans up all blockers during `app.on('before-quit')`.

### B. IPC Layer: `src/main/ipc-handlers.ts` & `src/shared/types.ts`
New IPC channels:
- `awake:get-state`: returns `{ mode: KeepAwakeMode, isActive: boolean, preventDisplaySleep: boolean }`.
- `awake:set-mode`: sets mode (`smart` | `always` | `off`).
- `awake:set-prevent-display-sleep`: toggles whether display sleep is also prevented.
- `awake:state-changed`: push notification to renderer when active status changes.

### C. Renderer UI: Titlebar Quick Menu
- `src/renderer/components/Titlebar/KeepAwakeMenu.tsx` — a self-contained popover (same anchored-panel pattern as `NotificationBell`/`NotificationPanel`), mounted in `Titlebar.tsx` next to Focus Mode and Explorer.
- SVG Coffee Cup Icon (`IconCoffee` in `src/renderer/components/Titlebar/icons.tsx`) is the trigger button:
  - **Active** (`isActive: true`, any mode): highlighted/amber cup, full-opacity steam (`.titlebar__btn--awake-active`).
  - **Armed** (`smart`/`always` selected, `isActive: false` — waiting for an agent): outline cup tinted with `--ui-accent` at reduced opacity (`.titlebar__btn--awake-armed`) — needed so a selected-but-idle mode doesn't read as indistinguishable from the unselected default.
  - **Off:** outline cup at reduced opacity (`.titlebar__btn--awake-off`).
- **Click:** opens a dropdown panel (closes on outside click, Escape, or picking an option) — replaces the old click-to-cycle behavior.
- **Panel contents:** header (`Keep computer awake` · live status `"<Mode> · Active/Inactive"`), then three radio rows, each a label + one-line description, selecting one calls `setMode` directly:
  - **On** (`always`) — "Keep this computer awake continuously"
  - **Smart** (`smart`) — "Stay awake while an agent is working"
  - **Off** (`off`) — "Allow normal system sleep behavior"
- Data lives in an exported `KEEP_AWAKE_OPTIONS` table (mode/i18n key/fallback label+hint), not duplicated per JSX row.

### D. Settings & Config Integration
- **Settings UI (`src/renderer/components/Settings/WorkspaceSettings.tsx`):**
  - "Keep computer awake" radio group: *Smart (while agents work)* | *Always on* | *Off*.
  - Checkbox: *Keep display awake (prevents lock screen and SSH agent lockouts)*.
- **Configuration TOML (`~/.wmux/config.toml`):**
  ```toml
  [workspace.keep-awake]
  mode = "smart"                 # smart | always | off
  prevent-display-sleep = false  # true keeps display on
  ```

---

## 4. Error Handling & Edge Cases

1. **Agent Crashes or Ungraceful Disconnects:**
   `agent-state.ts` already implements `WORKING_TRUST_MS` (15-minute decay for unconfirmed claims) and `clearAgentState()` on PTY exit. If an agent dies without reporting, the decay ensures the awake assertion releases rather than running forever.
2. **Blocked on Human Input:**
   When an agent enters `awaitingHuman` (`blocked` state), it stops executing code. `AwakeManager` treats `blocked` as non-working so sleep is not held indefinitely while waiting for user response.
3. **App Exit / Reload:**
   `AwakeManager.dispose()` unconditionally releases any active `blockerId` on window reload or app quit.
4. **Multiple Windows:**
   Assertion state is tracked at the application singleton level in `main`, so secondary windows reflect and control the same global awake assertion.

---

## 5. Testing Plan

- **Unit Tests (`tests/unit/awake-manager.test.ts`):**
  - Mode switching between `smart`, `always`, and `off`.
  - Transitioning agent states (0 working → 1 working → blocker starts; 1 working → 0 working → blocker stops).
  - Transitioning between `working` and `blocked` (verifying release on human wait).
  - Display sleep toggle changing the `powerSaveBlocker` assertion type.
  - Verification that disposal releases active blockers cleanly.
- **Config & Settings Tests (`tests/unit/user-config.test.ts`):**
  - Parsing and validating `[workspace.keep-awake]` section in TOML.
