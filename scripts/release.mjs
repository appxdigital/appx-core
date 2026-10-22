#!/usr/bin/env node
/*
 * Release helper: bump a package's version, commit, and create the git tag
 * that the GitHub Actions release workflow keys off. It deliberately does NOT
 * push — pushing the tag is what triggers a live npm publish, so that stays a
 * separate, manual step:  git push origin HEAD --follow-tags
 *
 * Usage:
 *   node scripts/release.mjs <lib|cli> <patch|minor|major|prerelease|X.Y.Z> [preid]
 *
 * Examples:
 *   node scripts/release.mjs lib prerelease beta   # 0.1.121 -> 0.1.122-beta.0 (dist-tag beta)
 *   node scripts/release.mjs lib 0.1.121-beta.0    # explicit version
 *   node scripts/release.mjs lib patch             # 0.1.121-beta.3 -> 0.1.121 (production, gated)
 *   node scripts/release.mjs cli prerelease beta   # cli, tag cli-v...
 */
import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';

const TARGETS = {
    lib: {dir: '.', pkg: 'package.json', prefix: 'v', label: 'release'},
    cli: {dir: 'cli', pkg: 'cli/package.json', prefix: 'cli-v', label: 'release cli'},
};

const [, , target, bump, preid] = process.argv;
const t = TARGETS[target];
if (!t || !bump) {
    console.error('Usage: node scripts/release.mjs <lib|cli> <patch|minor|major|prerelease|X.Y.Z> [preid]');
    process.exit(1);
}

// Only tracked modifications block a release; stray untracked files (e.g. a
// downloaded log) are irrelevant since the version commit stages tracked files.
if (execSync('git status --porcelain --untracked-files=no').toString().trim()) {
    console.error('Working tree has uncommitted tracked changes — commit or stash before releasing.');
    process.exit(1);
}

const preidArg = preid ? `--preid ${preid}` : '';
execSync(`npm version ${bump} ${preidArg} --no-git-tag-version`, {cwd: t.dir, stdio: 'inherit'});

// Bake the current library version into the CLI (cli/core-version.json) so it
// ships in this release commit — `appx-core create` pins the matching lib
// version. Harmless for CLI releases (the lib version is unchanged); essential
// for library releases so the CLI's pin tracks the new version.
execSync('node scripts/sync-cli-core-version.mjs', {stdio: 'inherit'});

const version = JSON.parse(readFileSync(t.pkg, 'utf8')).version;
const tag = `${t.prefix}${version}`;

execSync(`git commit -am "${t.label}: ${version}"`, {stdio: 'inherit'});
execSync(`git tag ${tag}`, {stdio: 'inherit'});

const channel = /-alpha/.test(version)
    ? 'alpha'
    : /-beta/.test(version)
      ? 'beta'
      : /-/.test(version)
        ? 'next'
        : 'latest (production — gated by approval)';

console.log(`\n✔ Committed and tagged ${tag}  →  npm dist-tag: ${channel}`);
console.log('  Push to publish:  git push origin HEAD --follow-tags');
