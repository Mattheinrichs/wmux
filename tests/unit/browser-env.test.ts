import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { BROWSER_SHIM_NAME, WSL_ENV_PASSTHROUGH, browserEnvFor } from '../../src/main/pane-browser-env';

describe('pane BROWSER routing', () => {
  it('sets BROWSER for WSL panes only', () => {
    expect(browserEnvFor('wsl')).toEqual({ BROWSER: 'wmux-open-url' });
    expect(browserEnvFor('powershell')).toEqual({});
    expect(browserEnvFor('cmd')).toEqual({});
    expect(browserEnvFor('unknown')).toEqual({});
  });

  it('uses a whitespace-free name, because BROWSER is split on whitespace', () => {
    expect(BROWSER_SHIM_NAME).toBe('wmux-open-url');
    expect(BROWSER_SHIM_NAME).not.toMatch(/\s/);
  });

  it('passes BROWSER through to WSL unchanged', () => {
    expect(WSL_ENV_PASSTHROUGH.split(':')).toContain('BROWSER/u');
  });

  it('ships the shim as an LF bash script', () => {
    const raw = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'cli-bin', 'wmux-open-url'), 'utf8');
    expect(raw.startsWith('#!/usr/bin/env bash')).toBe(true);
    expect(raw).not.toMatch(/\r/);
  });
});
