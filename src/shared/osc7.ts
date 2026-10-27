// OSC 7 (`ESC ] 7 ; file://host/path ST`): a shell announcing its working
// directory IN-BAND, through the bytes it prints (#378). It is how a WSL shell
// tells the explorer where it is: `wsl` typed into a PowerShell pane gets no
// WMUX_SURFACE_ID and no pipe, but whatever it prints already reaches the
// right pane.
//
// In-band is also what makes it untrusted. The pipe's report_pwd needs the
// pipe token; OSC 7 can come from ANY byte stream the terminal shows — `cat`
// a hostile file and it has reported a cwd. The explorer root is a UX root and
// is jailed either way, so a forged LOCAL path costs nothing. A forged UNC
// path is different: the moment main realpaths `\\attacker\share`, Windows
// tries SMB and hands over the user's NTLM hash. So the allow-list is local
// drive paths and the WSL redirector roots, and nothing else.
//
// Pure, and run in MAIN (the renderer only forwards the raw payload): the
// gate must not live on the side of the boundary it is guarding.

/** wslpath -w output tops out far below this; anything longer is not a cwd. */
const MAX_OSC7_LENGTH = 4096;

const WSL_UNC = /^\\\\(?:wsl\.localhost|wsl\$)\\[\w.-]+(?:\\|$)/i;
const DRIVE = /^[A-Za-z]:(?:\\|$)/;

/**
 * The Windows directory an OSC 7 payload names, or null when it names nothing
 * wmux may act on. `localHostname` is the machine's own name: a URL naming
 * any other host describes a directory on another machine (an ssh session).
 */
export function parseOsc7Cwd(data: string, localHostname: string): string | null {
  if (typeof data !== 'string' || data.length === 0 || data.length > MAX_OSC7_LENGTH) return null;
  const m = /^file:\/\/([^/]*)(\/.*)$/i.exec(data);
  if (!m) return null;

  const host = m[1].toLowerCase();
  if (host && host !== 'localhost' && host !== localHostname.toLowerCase()) return null;

  const decoded = decodePath(m[2]);
  return decoded === null ? null : allowedWindowsPath(decoded);
}

/** Percent-decoded, or null when malformed or carrying a control character. */
function decodePath(raw: string): string | null {
  let p: string;
  try {
    p = decodeURIComponent(raw);
  } catch {
    return null;
  }
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return null;
  }
  return p;
}

/** The URL path as a Windows path, if it is one the allow-list admits. */
function allowedWindowsPath(urlPath: string): string | null {
  // The URL's own leading slash sits in front of a Windows path: `/C:/x`, or
  // `/\\wsl.localhost\…` from `wslpath -w`. `//host/share` is already a UNC
  // root (file:////wsl.localhost/…) and keeps both its slashes.
  let p = /^\/(?:[A-Za-z]:|\\)/.test(urlPath) ? urlPath.slice(1) : urlPath;
  p = p.replace(/\//g, '\\');

  if (DRIVE.test(p)) {
    p = p[0].toUpperCase() + p.slice(1);
    if (p.length === 2) p += '\\';
  } else if (!WSL_UNC.test(p)) {
    return null;
  }

  const segments = p.split('\\');
  if (segments.some((s) => s === '..')) return null;
  // A colon past the drive letter is an alternate data stream, not a folder.
  if (p.indexOf(':', 2) !== -1) return null;

  // A trailing separator, except the one that makes `C:\` a root.
  while (p.length > 3 && p.endsWith('\\')) p = p.slice(0, -1);
  return p;
}
