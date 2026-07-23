#!/usr/bin/env node
/*
 * Bake the library version (root package.json) into the CLI as
 * cli/core-version.json. `appx-core create` reads this to pin the matching
 * @appxdigital/appx-core version in the projects it scaffolds.
 *
 * The CLI is published straight from committed files with no build step
 * (see .github/workflows/release-cli.yml), so this file must be committed
 * and kept current. It is refreshed:
 *   - by scripts/release.mjs, so every release commit bakes the current
 *     library version, and
 *   - by `npm run build:cli` / `build:all`, for local freshness.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const target = join(root, 'cli', 'core-version.json');
const next = JSON.stringify({version: libVersion}, null, 4) + '\n';

let prev = '';
try {
    prev = readFileSync(target, 'utf8');
} catch {
    /* first run */
}

if (prev !== next) {
    writeFileSync(target, next);
    console.log(`Synced cli/core-version.json → ${libVersion}`);
} else {
    console.log(`cli/core-version.json already at ${libVersion}`);
}
