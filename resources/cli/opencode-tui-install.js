"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TUI_PLUGIN_VERSION_RE = void 0;
exports.tuiNeedsUpdate = tuiNeedsUpdate;
exports.isWmuxTuiFile = isWmuxTuiFile;
exports.opencodeConfigDir = opencodeConfigDir;
exports.opencodePluginSourceDir = opencodePluginSourceDir;
exports.installOpencodeTui = installOpencodeTui;
exports.removeOpencodeTui = removeOpencodeTui;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
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
exports.TUI_PLUGIN_VERSION_RE = /wmux-plugin-version:\s*(\S+)/;
/**
 * Pure: compare embedded version markers to decide whether to re-install.
 * Semantics are `pluginNeedsUpdate`'s: an unversioned SOURCE always
 * reinstalls (fail safe), and an unmarked TARGET at our own path is replaced.
 */
function tuiNeedsUpdate(src, target) {
    if (target === null)
        return true;
    const s = src.match(exports.TUI_PLUGIN_VERSION_RE)?.[1];
    const t = target.match(exports.TUI_PLUGIN_VERSION_RE)?.[1];
    if (s === undefined)
        return true;
    return s !== t;
}
/** Is this file one wmux installed? The guard on the uninstall path. */
function isWmuxTuiFile(contents) {
    return exports.TUI_PLUGIN_VERSION_RE.test(contents);
}
/**
 * The OpenCode config directory for the environment this process runs in.
 *
 * XDG counts only when absolute (the spec requires it, and a relative value
 * must not resolve against the pane's cwd), then the same `~/.config/opencode`
 * the server-side installer writes on every platform.
 */
function opencodeConfigDir(env, homedir) {
    const xdg = env.XDG_CONFIG_HOME?.trim();
    const base = xdg && path_1.default.isAbsolute(xdg) ? xdg : path_1.default.join(homedir, '.config');
    return path_1.default.join(base, 'opencode');
}
/**
 * Where the shipped TUI files live, relative to the running CLI.
 *
 * Packaged: `resources/cli/wmux.js` → `resources/opencode-plugin/` (siblings
 * through extraResources). Dev: `dist/cli/wmux.js` → `resources/opencode-plugin`.
 */
function opencodePluginSourceDir(cliDir, exists = fs_1.default.existsSync) {
    const candidates = [
        path_1.default.join(cliDir, '..', 'opencode-plugin'),
        path_1.default.join(cliDir, '..', '..', 'resources', 'opencode-plugin'),
    ];
    return candidates.find(exists) ?? null;
}
const ENTRY_SRC = 'wmux-tui.js';
const CORE_SRC = 'wmux-tui-core.js';
const ENTRY_DST = 'tui.js';
const CORE_DST = 'core.js';
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
function installOpencodeTui(opts) {
    const dir = path_1.default.join(opts.configDir, 'plugins', 'wmux-cli');
    const entrySrc = fs_1.default.readFileSync(path_1.default.join(opts.sourceDir, ENTRY_SRC), 'utf-8');
    const coreSrc = fs_1.default.readFileSync(path_1.default.join(opts.sourceDir, CORE_SRC), 'utf-8');
    const entryPath = path_1.default.join(dir, ENTRY_DST);
    const target = fs_1.default.existsSync(entryPath) ? fs_1.default.readFileSync(entryPath, 'utf-8') : null;
    const version = entrySrc.match(exports.TUI_PLUGIN_VERSION_RE)?.[1] ?? null;
    if (!tuiNeedsUpdate(entrySrc, target))
        return { status: 'current', dir, version };
    fs_1.default.mkdirSync(dir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(dir, CORE_DST), coreSrc, 'utf-8');
    fs_1.default.writeFileSync(entryPath, entrySrc, 'utf-8');
    return { status: 'installed', dir, version };
}
/**
 * Remove our two files, and the directory only when nothing else lives in it.
 * A `tui.js` without our marker is somebody's own file — never delete it, and
 * never guess that its sibling `core.js` is ours either.
 */
function removeOpencodeTui(opts) {
    const dir = path_1.default.join(opts.configDir, 'plugins', 'wmux-cli');
    const entryPath = path_1.default.join(dir, ENTRY_DST);
    if (!fs_1.default.existsSync(entryPath))
        return { status: 'absent', dir };
    if (!isWmuxTuiFile(fs_1.default.readFileSync(entryPath, 'utf-8')))
        return { status: 'foreign', dir };
    fs_1.default.unlinkSync(entryPath);
    const corePath = path_1.default.join(dir, CORE_DST);
    if (fs_1.default.existsSync(corePath))
        fs_1.default.unlinkSync(corePath);
    try {
        fs_1.default.rmdirSync(dir);
    }
    catch {
        // The user keeps other files there — leave the directory alone.
    }
    return { status: 'removed', dir };
}
