import { describe, it, expect } from 'vitest';
import { parseOsc7Cwd } from '../../src/shared/osc7';

const HOST = 'MY-PC';

describe('parseOsc7Cwd (#378)', () => {
  it('accepts the WSL one-liner form: a wslpath -w UNC path after file://localhost/', () => {
    expect(parseOsc7Cwd('file://localhost/\\\\wsl.localhost\\Ubuntu\\home\\u\\code', HOST))
      .toBe('\\\\wsl.localhost\\Ubuntu\\home\\u\\code');
  });

  it('accepts the legacy \\\\wsl$ root', () => {
    expect(parseOsc7Cwd('file://localhost/\\\\wsl$\\Ubuntu-22.04\\home\\u', HOST))
      .toBe('\\\\wsl$\\Ubuntu-22.04\\home\\u');
  });

  it('accepts a UNC root spelled with forward slashes', () => {
    expect(parseOsc7Cwd('file:////wsl.localhost/Ubuntu/home/u', HOST))
      .toBe('\\\\wsl.localhost\\Ubuntu\\home\\u');
  });

  it('accepts a distro root with no trailing path', () => {
    expect(parseOsc7Cwd('file://localhost/\\\\wsl.localhost\\Ubuntu', HOST))
      .toBe('\\\\wsl.localhost\\Ubuntu');
  });

  it('accepts a drive path, in both the URL and the wslpath spelling', () => {
    expect(parseOsc7Cwd('file:///C:/Users/me/repo', HOST)).toBe('C:\\Users\\me\\repo');
    expect(parseOsc7Cwd('file://localhost/D:\\x', HOST)).toBe('D:\\x');
  });

  it('turns a bare drive into its root', () => {
    expect(parseOsc7Cwd('file:///c:', HOST)).toBe('C:\\');
    expect(parseOsc7Cwd('file:///C:/', HOST)).toBe('C:\\');
  });

  it('percent-decodes the path', () => {
    expect(parseOsc7Cwd('file:///C:/My%20Repo/caf%C3%A9', HOST)).toBe('C:\\My Repo\\café');
  });

  it('accepts the local hostname, case-insensitively, and an empty host', () => {
    expect(parseOsc7Cwd('file://my-pc/C:/x', HOST)).toBe('C:\\x');
    expect(parseOsc7Cwd('file:///C:/x', HOST)).toBe('C:\\x');
  });

  it('rejects any other host: that cwd lives on another machine', () => {
    expect(parseOsc7Cwd('file://build-box/C:/x', HOST)).toBeNull();
  });

  it('rejects a UNC root on any host but WSL — an SMB path would leak the NTLM hash', () => {
    expect(parseOsc7Cwd('file://localhost/\\\\evil\\share', HOST)).toBeNull();
    expect(parseOsc7Cwd('file:////evil/share', HOST)).toBeNull();
    expect(parseOsc7Cwd('file://localhost/\\\\evil.wsl.localhost\\share', HOST)).toBeNull();
    expect(parseOsc7Cwd('file://localhost/\\\\wsl.localhost.evil.com\\x', HOST)).toBeNull();
  });

  it('rejects device paths', () => {
    expect(parseOsc7Cwd('file://localhost/\\\\?\\C:\\x', HOST)).toBeNull();
    expect(parseOsc7Cwd('file://localhost/\\\\.\\pipe\\wmux', HOST)).toBeNull();
  });

  it('rejects a .. segment rather than trusting normalization to keep it inside the root', () => {
    expect(parseOsc7Cwd('file://localhost/\\\\wsl$\\Ubuntu\\..\\..\\evil\\share', HOST)).toBeNull();
    expect(parseOsc7Cwd('file:///C:/a/%2E%2E/b', HOST)).toBeNull();
  });

  it('rejects a POSIX path: without wslpath there is no Windows path to map it to', () => {
    expect(parseOsc7Cwd('file://localhost/home/u', HOST)).toBeNull();
    expect(parseOsc7Cwd('file:///mnt/c/Users', HOST)).toBeNull();
  });

  it('rejects anything that is not a file: URL', () => {
    expect(parseOsc7Cwd('http://localhost/C:/x', HOST)).toBeNull();
    expect(parseOsc7Cwd('C:\\x', HOST)).toBeNull();
    expect(parseOsc7Cwd('', HOST)).toBeNull();
  });

  it('rejects malformed percent-encoding, control characters and stray colons', () => {
    expect(parseOsc7Cwd('file:///C:/%E0%A4%A', HOST)).toBeNull();
    expect(parseOsc7Cwd('file:///C:/a%0Ab', HOST)).toBeNull();
    expect(parseOsc7Cwd('file:///C:/a:stream', HOST)).toBeNull();
  });

  it('rejects an oversized payload', () => {
    expect(parseOsc7Cwd(`file:///C:/${'a'.repeat(5000)}`, HOST)).toBeNull();
  });

  it('drops a trailing separator except at a root', () => {
    expect(parseOsc7Cwd('file:///C:/Users/', HOST)).toBe('C:\\Users');
  });
});
