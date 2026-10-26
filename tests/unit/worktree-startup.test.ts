import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const MAIN_DIR = join(__dirname, '../../src/main');
const INDEX = readFileSync(join(MAIN_DIR, 'index.ts'), 'utf8');

describe('worktree startup reconciliation wiring', () => {
  it('runs unawaited, so startup never blocks on git commands (#176)', () => {
    expect(INDEX).toMatch(/reconcileOrphans\(/);
    expect(INDEX).not.toMatch(/await reconcileOrphans/);
  });

  it('orders worktree startup sweep after reconcileOrphanSessions', () => {
    const orphanSessions = INDEX.indexOf('reconcileOrphanSessions');
    const worktreeReconcile = INDEX.indexOf('reconcileOrphans');
    expect(orphanSessions).toBeGreaterThan(-1);
    expect(worktreeReconcile).toBeGreaterThan(orphanSessions);
    // Keep it in the startup cleanup block
    expect(worktreeReconcile - orphanSessions).toBeLessThan(1_500);
  });

  it('reads the claimed worktrees from loadSession()', () => {
    expect(INDEX).toMatch(/claimed\s*=\s*\(loadSession\(\)\?\.windows\s*\?\?\s*\[\]\)/);
    expect(INDEX).toMatch(/\.flatMap\(\(w\)\s*=>\s*w\.workspaces\s*\?\?\s*\[\]\)/);
    expect(INDEX).toMatch(/\.map\(\(w\)\s*=>\s*w\.worktree\?\.worktreePath\)/);
    expect(INDEX).toMatch(/\.filter\(\(p\):\s*p\s+is\s+string\s*=>\s*!{2}p\)/);
  });

  it('logs only counts and error codes, with no interpolated path variables (#174)', () => {
    const start = INDEX.indexOf('reconcileOrphans(claimed)');
    expect(start).toBeGreaterThan(-1);
    // Extract through the end of the .catch block
    const catchIndex = INDEX.indexOf('.catch(', start);
    expect(catchIndex).toBeGreaterThan(-1);
    const end = INDEX.indexOf('});', catchIndex) + 3;
    const sweepBlock = INDEX.slice(start, end);

    // Verify console and diagnostic calls match the specification
    expect(sweepBlock).toContain('console.log(`[worktree] startup sweep: ${removed} removed, ${kept} kept`)');
    expect(sweepBlock).toContain("logDiagnostic('worktree-reconcile', { removed, kept })");
    expect(sweepBlock).toContain("console.warn(`[worktree] startup sweep failed: ${err?.code ?? 'UNKNOWN'}`)");
    expect(sweepBlock).toContain("logDiagnostic('worktree-reconcile-error', { code: err?.code ?? 'UNKNOWN' })");

    // Ensure no interpolated path variables (#174)
    expect(sweepBlock).not.toMatch(/\$\{[^}]*path[^}]*\}/i);
    expect(sweepBlock).not.toMatch(/\$\{[^}]*worktree[^}]*\}/i);
    expect(sweepBlock).not.toMatch(/\$\{[^}]*dir[^}]*\}/i);
  });
});
