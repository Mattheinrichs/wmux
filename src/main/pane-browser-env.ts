/**
 * The `$BROWSER` wiring a pane gets, split out of pty-manager so it is testable
 * without loading node-pty's native module.
 */

/**
 * The `$BROWSER` target wmux installs into WSL panes.
 *
 * Deliberately the bare name, not a path: BROWSER parsers split the value on
 * whitespace, and an install path can contain spaces ("OneDrive - Pulsa"). The
 * shim lives in cli-bin, which is already prepended to PATH.
 */
export const BROWSER_SHIM_NAME = 'wmux-open-url';

/** Only WSL panes get the shim: native Windows tools cannot execute it. */
export function browserEnvFor(shellType: string): { BROWSER?: string } {
  return shellType === 'wsl' ? { BROWSER: BROWSER_SHIM_NAME } : {};
}

/**
 * Windows env vars WSL keeps. /u passes through unchanged; /up also translates
 * a Windows path to a WSL mount (/mnt/c/...). BROWSER is a bare command name,
 * so /u is the right mode.
 */
export const WSL_ENV_PASSTHROUGH =
  'WMUX/u:WMUX_SURFACE_ID/u:WMUX_CLI/up:WMUX_PIPE/u:WMUX_PIPE_TOKEN/u:WMUX_INTEGRATION/u'
  + ':WMUX_REMOTE/u:WMUX_REMOTE_TOKEN/u:BROWSER/u';
