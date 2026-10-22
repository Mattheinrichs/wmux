#!/usr/bin/env node
// Rewrite bucket/wmux.json for a release (#321).
//
//   node scripts/update-scoop-manifest.mjs <version> <path-to-win-x64.zip>
//
// The repo doubles as a Scoop bucket (Scoop reads manifests from `bucket/`):
//
//   scoop bucket add wmux https://github.com/amirlehmam/wmux
//   scoop install wmux/wmux
//
// A custom bucket has no Excavator bot running `checkver -u` for it, so the
// release workflow runs this after publishing and commits the result. The hash
// is computed from the very zip that was uploaded, never re-downloaded.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [version, zipPath] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !zipPath) {
  console.error('usage: update-scoop-manifest.mjs <x.y.z> <zip>');
  process.exit(2);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = join(root, 'bucket', 'wmux.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
manifest.version = version;
manifest.architecture['64bit'].url =
  `https://github.com/amirlehmam/wmux/releases/download/v${version}/wmux-${version}-win-x64.zip`;
manifest.architecture['64bit'].hash = hash;

writeFileSync(manifestPath, JSON.stringify(manifest, null, 4) + '\n');
console.log(`bucket/wmux.json -> ${version} sha256=${hash}`);
