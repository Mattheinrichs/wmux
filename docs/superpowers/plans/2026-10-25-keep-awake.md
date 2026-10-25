# Windows Keep-Awake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Windows awake dynamically while coding agents are working in wmux, with manual override controls and optional display sleep prevention.

**Architecture:** An `AwakeManager` singleton in the main process monitors active agent states from `agent-state.ts`. When agents are in the `working` state, it acquires Electron's native `powerSaveBlocker` (`prevent-app-suspension` or `prevent-display-sleep`). It exposes state via IPC to the renderer, where a coffee cup button in the titlebar and a section in Settings allow switching modes (`smart`, `always`, `off`) and toggling display sleep.

**Tech Stack:** Electron (`powerSaveBlocker`, `ipcMain`), TypeScript, React, Zustand, Vitest.

**Spec:** [`docs/superpowers/specs/2026-10-25-keep-awake-design.md`](file:///D:/professional/code/learn/wmux/.worktrees/feat-keep-awake/docs/superpowers/specs/2026-10-25-keep-awake-design.md)

---

## Global Constraints

- **Platform:** Windows-only runtime behavior; safe no-op on non-Windows platforms.
- **TDD:** Strict Red-Green-Refactor development. All logic and state transitions must be test-verified.
- **Power Management Integrity:** Never leave orphaned `powerSaveBlocker` assertions on app exit, reload, or crash.
- **Non-blocking:** Agent state listeners must never throw or block IPC operations.

## Review Focus

1. **State decay resilience:** If an agent dies without reporting, does the 15-minute trust window in `agent-state.ts` cause `AwakeManager` to release the blocker?
2. **Blocked vs Working distinction:** When an agent is `blocked` waiting on human input, does `AwakeManager` release the blocker so power isn't wasted?
3. **Mode transition cleanup:** When switching from `always` to `off` or `smart` with 0 agents, is the active blocker immediately stopped?
4. **Display sleep assertion upgrade:** When toggling `preventDisplaySleep` while active, does it cleanly swap `prevent-app-suspension` to `prevent-display-sleep`?
5. **Multiple windows / reloads:** Are assertions tracked centrally so multiple windows share the exact same state without double-locking?

---

### Task 1: Core `AwakeManager` State Machine & `powerSaveBlocker` Controller

**Files:**
- Create: `src/main/awake-manager.ts`
- Test: `tests/unit/awake-manager.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export type KeepAwakeMode = 'smart' | 'always' | 'off';

  export interface KeepAwakeState {
    mode: KeepAwakeMode;
    isActive: boolean;
    preventDisplaySleep: boolean;
    blockerType: 'prevent-app-suspension' | 'prevent-display-sleep';
  }

  export interface PowerBlockerDriver {
    start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number;
    stop(id: number): void;
    isStarted(id: number): boolean;
  }

  export class AwakeManager {
    constructor(driver?: PowerBlockerDriver);
    getState(): KeepAwakeState;
    setMode(mode: KeepAwakeMode): void;
    setPreventDisplaySleep(prevent: boolean): void;
    onWorkingAgentsCountChanged(workingCount: number): void;
    onStateChange(listener: (state: KeepAwakeState) => void): () => void;
    dispose(): void;
  }
  ```

- [ ] **Step 1: Write unit tests for `AwakeManager` state transitions**
  In `tests/unit/awake-manager.test.ts`:
  - Test initial state (`mode: 'smart'`, `isActive: false`, `preventDisplaySleep: false`).
  - Test smart mode: 0 working -> 1 working calls `driver.start('prevent-app-suspension')` and sets `isActive: true`.
  - Test smart mode: 1 working -> 0 working calls `driver.stop(id)` and sets `isActive: false`.
  - Test always mode: immediately acquires blocker regardless of working count.
  - Test off mode: releases blocker even if working count > 0.
  - Test display sleep toggle: when active, stops previous blocker and restarts with `prevent-display-sleep`.
  - Test dispose: cleans up active blocker.

- [ ] **Step 2: Run test to verify it fails**
  Run: `npx vitest run tests/unit/awake-manager.test.ts`
  Expected: FAIL (module `awake-manager` not found).

- [ ] **Step 3: Implement `AwakeManager` in `src/main/awake-manager.ts`**
  Implement class with dependency injection for `PowerBlockerDriver` (defaulting to Electron's `powerSaveBlocker`).

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/unit/awake-manager.test.ts`
  Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**
  ```bash
  git add src/main/awake-manager.ts tests/unit/awake-manager.test.ts
  git commit -m "feat(awake): add AwakeManager state machine and powerSaveBlocker controller"
  ```

---

### Task 2: Shared Types, IPC Channels, and Persistence

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/main/settings-store.ts`
- Test: `tests/unit/settings-store.test.ts`

**Interfaces:**
- Consumes: `KeepAwakeMode`, `KeepAwakeState` from `src/main/awake-manager.ts`
- Produces:
  - Add to `IPC_CHANNELS`:
    - `AWAKE_GET_STATE: 'awake:get-state'`
    - `AWAKE_SET_MODE: 'awake:set-mode'`
    - `AWAKE_SET_PREVENT_DISPLAY_SLEEP: 'awake:set-prevent-display-sleep'`
    - `AWAKE_STATE_CHANGED: 'awake:state-changed'`
  - Add to `WorkspacePrefs`:
    - `keepAwakeMode?: KeepAwakeMode` (default `'smart'`)
    - `preventDisplaySleep?: boolean` (default `false`)

- [ ] **Step 1: Write test for persisting keep-awake preferences**
  In `tests/unit/settings-store.test.ts`:
  - Test that `loadSettings` initializes `keepAwakeMode: 'smart'` and `preventDisplaySleep: false`.
  - Test saving and reading back updated `keepAwakeMode` and `preventDisplaySleep`.

- [ ] **Step 2: Run test to verify failure**
  Run: `npx vitest run tests/unit/settings-store.test.ts`
  Expected: FAIL on missing fields.

- [ ] **Step 3: Implement type definitions and settings defaults**
  - Update `src/shared/types.ts` with channels and preference types.
  - Update `src/main/settings-store.ts` to include defaults and persistence.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/unit/settings-store.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/shared/types.ts src/main/settings-store.ts tests/unit/settings-store.test.ts
  git commit -m "feat(awake): add IPC channels and workspace preference persistence"
  ```

---

### Task 3: Main Process Wiring (agent-state events & IPC Handlers)

**Files:**
- Modify: `src/main/ipc-handlers.ts`
- Modify: `src/main/index.ts`
- Test: `tests/unit/awake-integration.test.ts`

**Interfaces:**
- Consumes: `AwakeManager`, `onAgentStateBroadcast`, `listAgentStates` from `agent-state.ts`
- Produces: Live awake synchronization between agent activity, main process assertions, and all browser windows.

- [ ] **Step 1: Write integration unit test for agent-state broadcast to AwakeManager**
  In `tests/unit/awake-integration.test.ts`:
  - Mock `agent-state` and test that calling `reportAgent(..., { runDepth: 1 })` triggers `onWorkingAgentsCountChanged` on `AwakeManager`.
  - Verify that transitioning agent to `awaitingHuman: true` drops working count to 0 and releases blocker.

- [ ] **Step 2: Run test to verify failure**
  Run: `npx vitest run tests/unit/awake-integration.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Wire AwakeManager into `src/main/index.ts` and `src/main/ipc-handlers.ts`**
  - In `src/main/index.ts`: instantiate `awakeManager` with saved prefs.
  - Subscribe to `onAgentStateBroadcast(() => awakeManager.onWorkingAgentsCountChanged(listAgentStates().filter(s => s.state === 'working').length))`.
  - In `src/main/ipc-handlers.ts`: register `AWAKE_GET_STATE`, `AWAKE_SET_MODE`, and `AWAKE_SET_PREVENT_DISPLAY_SLEEP`.
  - Broadcast `AWAKE_STATE_CHANGED` to all windows on awake state changes.
  - In `app.on('before-quit')`: invoke `awakeManager.dispose()`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/unit/awake-integration.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/main/index.ts src/main/ipc-handlers.ts tests/unit/awake-integration.test.ts
  git commit -m "feat(awake): wire AwakeManager to agent-state lifecycle and IPC handlers"
  ```

---

### Task 4: Titlebar Coffee Cup Quick-Control Component

**Files:**
- Modify: `src/renderer/components/Titlebar/icons.tsx`
- Modify: `src/renderer/components/Titlebar/Titlebar.tsx`
- Modify: `src/renderer/styles/titlebar.css`
- Test: `tests/unit/titlebar-awake.test.ts`

**Interfaces:**
- Consumes: `KeepAwakeState`
- Produces: Titlebar Coffee button with visual active/inactive states and mode cycling on click.

- [ ] **Step 1: Write unit test for Titlebar Coffee button rendering and click handler**
  In `tests/unit/titlebar-awake.test.ts`:
  - Test rendering `IconCoffee` with title/tooltip reflecting mode and active state.
  - Test clicking cycles through `smart` -> `always` -> `off` -> `smart`.

- [ ] **Step 2: Run test to verify failure**
  Run: `npx vitest run tests/unit/titlebar-awake.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Add `IconCoffee` and integrate into `Titlebar.tsx`**
  - Add SVG icon in `icons.tsx`.
  - Add coffee button beside Focus Mode in `Titlebar.tsx`.
  - Add CSS classes in `titlebar.css` (`.titlebar__btn--awake-active`, etc.).

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/unit/titlebar-awake.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/renderer/components/Titlebar/icons.tsx src/renderer/components/Titlebar/Titlebar.tsx src/renderer/styles/titlebar.css tests/unit/titlebar-awake.test.ts
  git commit -m "feat(awake): add coffee cup toggle button to Titlebar"
  ```

---

### Task 5: Workspace Settings UI & Config TOML Parsing

**Files:**
- Modify: `src/renderer/components/Settings/WorkspaceSettings.tsx`
- Modify: `src/shared/user-config.ts`
- Modify: `src/renderer/i18n/locales/en.ts`
- Test: `tests/unit/user-config-awake.test.ts`

**Interfaces:**
- Consumes: `keep-awake` section in TOML, `KeepAwakeState` in settings store.
- Produces: Configuration options in settings modal and TOML parser.

- [ ] **Step 1: Write test for TOML parsing of `[workspace.keep-awake]`**
  In `tests/unit/user-config-awake.test.ts`:
  - Test parsing `[workspace.keep-awake] mode = "always"`, `prevent-display-sleep = true`.
  - Test default fallback when omitted.

- [ ] **Step 2: Run test to verify failure**
  Run: `npx vitest run tests/unit/user-config-awake.test.ts`
  Expected: FAIL.

- [ ] **Step 3: Update `user-config.ts`, `WorkspaceSettings.tsx`, and `en.ts`**
  - Add `parseKeepAwakeConfig` in `src/shared/user-config.ts`.
  - Add Keep Awake section in `WorkspaceSettings.tsx` with mode radios and display sleep checkbox.
  - Add localization strings in `src/renderer/i18n/locales/en.ts`.

- [ ] **Step 4: Run test to verify it passes**
  Run: `npx vitest run tests/unit/user-config-awake.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/shared/user-config.ts src/renderer/components/Settings/WorkspaceSettings.tsx src/renderer/i18n/locales/en.ts tests/unit/user-config-awake.test.ts
  git commit -m "feat(awake): add settings UI and config TOML support"
  ```

---

### Task 6: Full Integration Build & Regression Verification

**Files:**
- Verify: Entire repository in `.worktrees/feat-keep-awake`

- [ ] **Step 1: Run all unit tests**
  Run: `npx vitest run`
  Expected: PASS on all tests across the suite.

- [ ] **Step 2: Run type check and lint**
  Run: `npm run lint` / `npx tsc --noEmit`
  Expected: 0 errors.

- [ ] **Step 3: Final commit and worktree status check**
  ```bash
  git status
  ```
