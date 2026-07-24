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
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const PKG = '@appxdigital/appx-core';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const libVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const target = join(root, 'cli', 'core-version.json');

let prev = '';
try {
    prev = readFileSync(target, 'utf8');
} catch {
    /* first run */
}
const prevVersion = prev ? JSON.parse(prev).version : null;

/**
 * Is this version actually on npm? The pin MUST name a published version:
 * `appx-core create` writes it into the scaffolded project and runs a real
 * `npm install`, so an unpublished pin fails with ETARGET.
 *
 * Returns false when the registry can't be reached, which is the safe
 * direction — we keep the known-good pin rather than bake something
 * unverifiable.
 */
const isPublished = (version) => {
    try {
        const out = execFileSync('npm', ['view', `${PKG}@${version}`, 'version'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 20_000,
        });
        return out.includes(version);
    } catch {
        return false;
    }
};

if (prevVersion === libVersion) {
    console.log(`cli/core-version.json already at ${libVersion}`);
} else if (!isPublished(libVersion)) {
    // Expected on a release commit: the version was just bumped and its
    // production publish is still waiting on the approval gate. Keep the
    // previous (published) pin; a later release re-runs this and picks it up
    // once it is live.
    console.log(
        `Leaving cli/core-version.json at ${prevVersion} — ${PKG}@${libVersion} is not published yet.`,
    );
} else {
    writeFileSync(target, JSON.stringify({version: libVersion}, null, 4) + '\n');
    console.log(`Synced cli/core-version.json → ${libVersion}`);
}
