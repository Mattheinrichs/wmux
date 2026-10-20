// wmux OpenCode CLI-side (TUI) plugin — the parts wmux's test suite can load.
//
// The installed entry (tui.js) imports @opencode/plugin/tui and solid-js,
// which only exist inside the TUI host; this module deliberately imports node
// builtins only, so routing and reporting rules stay unit-testable in wmux's
// own suite. Installed beside the entry as core.js (issue #310).
//
// No version marker here: the marker on tui.js is what the installer compares,
// and the pair is always written together (core first, entry last).
import { execFile } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * OpenCode session ids are `ses_` + base62. Same rule as the server half
 * (resources/opencode-plugin/wmux.js) and main's validator: strict because the
 * value ends up on a restored pane's command line, and the two halves are
 * installed separately so neither can import the other.
 */
export const SESSION_ID_RE = /^ses_[A-Za-z0-9]{8,120}$/;

/** Basenames that can execute a .js file we hand them. */
const JS_RUNTIME_RE = /^(node|bun)(\.exe)?$/i;

/**
 * Find something that can run `$WMUX_CLI` (issue #187).
 *
 * `process.execPath` is only a JS runtime by accident of the host: under
 * Claude Code it is node.exe, under OpenCode it is the compiled `opencode.exe`,
 * and under a TUI running in WSL `WMUX_NODE` is a Windows path that does not
 * exist in the distro. Fall back to the host, then to PATH and the well-known
 * install directories — the same order the server half uses.
 */
export function resolveNodeRuntime(
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  exists = existsSync,
) {
  const declared = env.WMUX_NODE;
  if (declared && exists(declared)) {
    return { file: declared, electron: env.WMUX_NODE_ELECTRON === "1" };
  }
  if (execPath && JS_RUNTIME_RE.test(path.basename(execPath))) {
    return { file: execPath, electron: false };
  }
  const win = platform === "win32";
  const names = win ? ["node.exe", "bun.exe"] : ["node", "bun"];
  const found = firstExisting(candidateDirs(env, win), names, exists);
  return found ? { file: found, electron: false } : { file: "node", electron: false };
}

/** PATH, then the default install locations PATH may not mention. */
function candidateDirs(env, win) {
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path");
  const fromPath = pathKey && env[pathKey] ? env[pathKey].split(path.delimiter) : [];
  const defaults = win
    ? [
        env.ProgramFiles && path.join(env.ProgramFiles, "nodejs"),
        env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs", "nodejs"),
        env.USERPROFILE && path.join(env.USERPROFILE, ".bun", "bin"),
      ]
    : [
        "/usr/local/bin",
        "/usr/bin",
        "/opt/homebrew/bin",
        env.HOME && path.join(env.HOME, ".bun", "bin"),
      ];
  return [...fromPath, ...defaults].filter(Boolean);
}

/** First `dir/name` that exists, or null. Never throws on a malformed entry. */
function firstExisting(dirs, names, exists) {
  for (const dir of dirs) {
    for (const name of names) {
      try {
        const candidate = path.join(dir, name);
        if (exists(candidate)) return candidate;
      } catch {}
    }
  }
  return null;
}

/**
 * Where `WMUX_PLUGIN_DEBUG` should write, or null when debugging is off
 * (issue #190). A file, not the console: the TUI owns the terminal, and an
 * agent working inside it cannot read its own stderr.
 */
export function resolveDebugLog(value, tmpdir = os.tmpdir) {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v || v === "0" || v.toLowerCase() === "false") return null;
  if (v === "1" || v.toLowerCase() === "true") {
    try {
      return path.join(tmpdir(), "wmux-tui-plugin-debug.log");
    } catch {
      return null;
    }
  }
  return v;
}

/** One-line, length-capped rendering of anything, including circular values. */
export function summarize(value, max = 300) {
  let s;
  try {
    s = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    s = null;
  }
  if (typeof s !== "string") s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Appender for `file`, or a no-op when debugging is off.
 *
 * Synchronous on purpose: the ordering between an event and the CLI call it
 * caused is the diagnostic. Swallows every error — a full disk must not take
 * the TUI down with it.
 */
export function makeLogger(file) {
  if (!file) return () => {};
  return (label, data) => {
    try {
      const suffix = data === undefined ? "" : ` ${summarize(data)}`;
      appendFileSync(file, `${new Date().toISOString()} [wmux-tui] ${label}${suffix}\n`);
    } catch {}
  };
}

/**
 * Run the wmux CLI without ever blocking or throwing into OpenCode.
 *
 * argv is passed through untouched: `params` come from wmux itself and no
 * shell is involved unless the PATH fallback names `wmux`, which on Windows is
 * why the .cmd shim is refused (#154/#187).
 */
export function callWmux(runtime, argv, log = () => {}, env = process.env, platform = process.platform) {
  try {
    const cli = env.WMUX_CLI;
    const opts = { windowsHide: true };
    let file;
    let args;
    if (cli) {
      file = runtime.file;
      args = [cli, ...argv];
      // wmux's own Electron binary is Node only with this set; without it the
      // same exe opens a second wmux window.
      if (runtime.electron) opts.env = { ...env, ELECTRON_RUN_AS_NODE: "1" };
    } else if (platform === "win32") {
      // The PATH shim is `wmux.cmd`, which execFile cannot spawn without a
      // shell. Nothing to do — WMUX_CLI is always set alongside WMUX=1.
      log("cli: skipped (no WMUX_CLI on win32)", argv);
      return;
    } else {
      file = "wmux";
      args = argv;
    }
    log("cli", args);
    execFile(file, args, opts, (err, _stdout, stderr) => {
      if (err || stderr) {
        log(`cli: ${argv[0]} failed`, (err && err.message) || String(stderr).trim());
      } else {
        log(`cli: ${argv[0]} ok`);
      }
    });
  } catch (err) {
    log("cli: threw", (err && err.message) || String(err));
  }
}

/**
 * The session id a route names, or null when there is nothing to report.
 *
 * A viewed subagent is not a resumable handle — the server half skips a
 * session born with a `parentID`, and the TUI-side equivalent is to report the
 * root the child belongs to. A root lookup that fails or answers nothing
 * leaves the viewed id alone; dropping the handle on a transient store miss
 * would make restore forget the session for good.
 */
export function planSessionReport(route, rootOf) {
  if (!route || route.type !== "session" || typeof route.sessionID !== "string") return null;
  let id = route.sessionID;
  try {
    const root = typeof rootOf === "function" ? rootOf(id) : undefined;
    if (typeof root === "string" && SESSION_ID_RE.test(root)) id = root;
  } catch {}
  return SESSION_ID_RE.test(id) ? id : null;
}

/**
 * Reports the viewed session to wmux, once per session, and releases the last
 * handle on dispose.
 *
 * `last` is intentionally sticky across navigation to a non-session route:
 * the pane's conversation is still the last one it was in, and restore should
 * reopen it. `disposed` is sticky too — a disposed TUI must not resurrect a
 * handle when a late store update fires.
 */
export function createSessionReporter({ surface, callWmux: send, log = () => {} }) {
  let last = null;
  let disposed = false;
  return {
    observe(route, rootOf) {
      if (disposed) return;
      const id = planSessionReport(route, rootOf);
      if (!id || id === last) return;
      last = id;
      log("session", id);
      send(["report-session", id, "--provider", "opencode", "--surface", surface]);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (!last) return;
      const id = last;
      last = null;
      send(["release-agent", "--provider", "opencode", "--session", id, "--surface", surface]);
    },
  };
}
