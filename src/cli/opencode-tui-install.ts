import fs from 'fs';
import path from 'path';

/**
 * Install/remove the CLI-side (TUI) half of the OpenCode integration (#310).
 *
 * Runs INSIDE the environment that will host the TUI — a WSL distro, a
 * devcontainer, or native Windows — because that is where `$HOME` /
 * `$XDG_CONFIG_HOME` and the shipped plugin files are both reachable. A
 * Windows-side writer for WSL homes would need distro/user discovery, would
 * silently write into arbitrary homes (the #132 consent question at another
 * level), and could not serve devcontainers at all.
 *
 * src/cli ships as standalone JS in `resources/cli`, while
 * `agent-plugin-file.ts` ships inside the asar — so the marker rule cannot be
 * imported here. TUI_PLUGIN_VERSION_RE is a verbatim copy, pinned to the
 * original by a test: two answers to "is this ours?" is the bug that file
 * exists to prevent.
 */
export const TUI_PLUGIN_VERSION_RE = /wmux-plugin-version:\s*(\S+)/;

/**
 * Pure: compare embedded version markers to decide whether to re-install.
 * Semantics are `pluginNeedsUpdate`'s: an unversioned SOURCE always
 * reinstalls (fail safe), and an unmarked TARGET at our own path is replaced.
 */
export function tuiNeedsUpdate(src: string, target: string | null): boolean {
  if (target === null) return true;
  const s = src.match(TUI_PLUGIN_VERSION_RE)?.[1];
  const t = target.match(TUI_PLUGIN_VERSION_RE)?.[1];
  if (s === undefined) return true;
  return s !== t;
}

/** Is this file one wmux installed? The guard on the uninstall path. */
export function isWmuxTuiFile(contents: string): boolean {
  return TUI_PLUGIN_VERSION_RE.test(contents);
}

/**
 * The OpenCode config directory for the environment this process runs in.
 *
 * XDG counts only when absolute (the spec requires it, and a relative value
 * must not resolve against the pane's cwd), then the same `~/.config/opencode`
 * the server-side installer writes on every platform.
 */
export function opencodeConfigDir(env: NodeJS.ProcessEnv, homedir: string): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(homedir, '.config');
  return path.join(base, 'opencode');
}

/**
 * Where the shipped TUI files live, relative to the running CLI.
 *
 * Packaged: `resources/cli/wmux.js` → `resources/opencode-plugin/` (siblings
 * through extraResources). Dev: `dist/cli/wmux.js` → `resources/opencode-plugin`.
 */
export function opencodePluginSourceDir(
  cliDir: string,
  exists: (p: string) => boolean = fs.existsSync,
): string | null {
  const candidates = [
    path.join(cliDir, '..', 'opencode-plugin'),
    path.join(cliDir, '..', '..', 'resources', 'opencode-plugin'),
  ];
  return candidates.find(exists) ?? null;
}

const ENTRY_SRC = 'wmux-tui.js';
const CORE_SRC = 'wmux-tui-core.js';
const ENTRY_DST = 'tui.js';
const CORE_DST = 'core.js';

export interface TuiInstallResult {
  status: 'installed' | 'current';
  dir: string;
  version: string | null;
}

/**
 * Write `<config>/plugins/wmux-cli/{tui,core}.js`.
 *
 * The discovery path is the one verified live on Windows wmux + a WSL pane
 * against a remote OpenCode server: a directory under `plugins/` resolves
 * `<dir>/tui` through the host's resolver, no package.json needed.
 *
 * Core is written before the entry because the entry's marker is what says
 * "the pair is current" — a crash between the two writes leaves the old
 * marker in place and the next run writes both again.
 */
export function installOpencodeTui(opts: { sourceDir: string; configDir: string }): TuiInstallResult {
  const dir = path.join(opts.configDir, 'plugins', 'wmux-cli');
  const entrySrc = fs.readFileSync(path.join(opts.sourceDir, ENTRY_SRC), 'utf-8');
  const coreSrc = fs.readFileSync(path.join(opts.sourceDir, CORE_SRC), 'utf-8');
  const entryPath = path.join(dir, ENTRY_DST);
  const target = fs.existsSync(entryPath) ? fs.readFileSync(entryPath, 'utf-8') : null;
  const version = entrySrc.match(TUI_PLUGIN_VERSION_RE)?.[1] ?? null;

  if (!tuiNeedsUpdate(entrySrc, target)) return { status: 'current', dir, version };

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, CORE_DST), coreSrc, 'utf-8');
  fs.writeFileSync(entryPath, entrySrc, 'utf-8');
  return { status: 'installed', dir, version };
}

export interface TuiRemoveResult {
  status: 'removed' | 'absent' | 'foreign';
  dir: string;
}

/**
 * Remove our two files, and the directory only when nothing else lives in it.
 * A `tui.js` without our marker is somebody's own file — never delete it, and
 * never guess that its sibling `core.js` is ours either.
 */
export function removeOpencodeTui(opts: { configDir: string }): TuiRemoveResult {
  const dir = path.join(opts.configDir, 'plugins', 'wmux-cli');
  const entryPath = path.join(dir, ENTRY_DST);
  if (!fs.existsSync(entryPath)) return { status: 'absent', dir };
  if (!isWmuxTuiFile(fs.readFileSync(entryPath, 'utf-8'))) return { status: 'foreign', dir };

  fs.unlinkSync(entryPath);
  const corePath = path.join(dir, CORE_DST);
  if (fs.existsSync(corePath)) fs.unlinkSync(corePath);
  try {
    fs.rmdirSync(dir);
  } catch {
    // The user keeps other files there — leave the directory alone.
  }
  return { status: 'removed', dir };
}
