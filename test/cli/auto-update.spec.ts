/**
 * Unit tests for the CLI self-update module (`cli/auto-update.cjs`).
 *
 * The module is CommonJS (imported as a default import by the ESM
 * `cli.js`, and require()d here). Every subprocess touchpoint — the
 * registry read and the `npm install -g` — is injected via `deps`, so
 * these tests never hit the network or npm. Each test gets its own
 * throwaway state dir so the on-disk `state.json` / `install.lock` /
 * `last-install.log` are isolated.
 */
import * as os from 'os';
import * as path from 'path';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const autoUpdate = require('../../cli/auto-update.cjs');

const PKG = '@appxdigital/appx-core-cli';

function freshStateDir(): string {
    return mkdtempSync(path.join(os.tmpdir(), 'appx-au-'));
}

/** A fixed clock so throttle/back-off windows are deterministic. */
const FIXED_NOW = 1_700_000_000_000;
const now = () => FIXED_NOW;

/** npmView stub that always returns `version`. */
const npmViewReturning = (version: string | null) =>
    jest.fn(async () => version);

/** installRunner stub with a fixed exit code. */
const runnerExiting = (exitCode: number) =>
    jest.fn(async () => ({ exitCode }));

describe('cli/auto-update — channel + version helpers', () => {
    it('infers beta from a prerelease suffix, production otherwise', () => {
        expect(autoUpdate.inferChannel('1.0.21')).toBe('production');
        expect(autoUpdate.inferChannel('1.0.22-beta.0')).toBe('beta');
        expect(autoUpdate.inferChannel('2.0.0-beta.3')).toBe('beta');
    });

    it('maps channels to npm dist-tags', () => {
        expect(autoUpdate.channelTag('beta')).toBe('beta');
        expect(autoUpdate.channelTag('production')).toBe('latest');
    });

    it('compares versions with prerelease awareness (beta.9 < beta.10)', () => {
        expect(autoUpdate.compareVersions('1.0.9', '1.0.10')).toBe(-1);
        expect(autoUpdate.compareVersions('1.0.0-beta.9', '1.0.0-beta.10')).toBe(-1);
        expect(autoUpdate.compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(autoUpdate.compareVersions('1.0.1', '1.0.0')).toBe(1);
        // a prerelease is older than its final release
        expect(autoUpdate.compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1);
    });
});

describe('cli/auto-update — checkForUpdate (background detection)', () => {
    let stateDir: string;
    beforeEach(() => { stateDir = freshStateDir(); });
    afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

    it('skips when disabled via env', async () => {
        const prev = process.env[autoUpdate.ENV_DISABLE];
        process.env[autoUpdate.ENV_DISABLE] = '1';
        try {
            const npmView = npmViewReturning('9.9.9');
            const res = await autoUpdate.checkForUpdate({
                packageName: PKG, currentVersion: '1.0.21', stateDir,
                deps: { npmView, now },
            });
            expect(res.skippedReason).toBe('disabled-env');
            expect(npmView).not.toHaveBeenCalled();
        } finally {
            if (prev === undefined) delete process.env[autoUpdate.ENV_DISABLE];
            else process.env[autoUpdate.ENV_DISABLE] = prev;
        }
    });

    it('stages a pendingUpdate when a newer version is published', async () => {
        const npmView = npmViewReturning('1.0.22');
        const res = await autoUpdate.checkForUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            deps: { npmView, now },
        });
        expect(res.newerAvailable).toBe(true);
        expect(res.latestVersion).toBe('1.0.22');

        const state = autoUpdate.readState(stateDir);
        expect(state.pendingUpdate).toMatchObject({ version: '1.0.22', channel: 'production' });
        expect(state.lastUpdateCheckedAt).toBe(FIXED_NOW);
    });

    it('infers the beta channel from a prerelease installed version', async () => {
        const npmView = npmViewReturning('1.0.22-beta.5');
        await autoUpdate.checkForUpdate({
            packageName: PKG, currentVersion: '1.0.22-beta.4', stateDir,
            deps: { npmView, now },
        });
        // asked npm for the beta dist-tag
        expect(npmView).toHaveBeenCalledWith(PKG, 'beta');
        expect(autoUpdate.readState(stateDir).pendingUpdate.channel).toBe('beta');
    });

    it('does not stage anything when already current', async () => {
        const npmView = npmViewReturning('1.0.21');
        const res = await autoUpdate.checkForUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            deps: { npmView, now },
        });
        expect(res.newerAvailable).toBe(false);
        expect(autoUpdate.readState(stateDir).pendingUpdate).toBeNull();
    });

    it('honours the throttle window', async () => {
        // Seed a recent check timestamp.
        autoUpdate.writeState({ lastUpdateCheckedAt: FIXED_NOW - 1000 }, stateDir);
        const npmView = npmViewReturning('2.0.0');
        const res = await autoUpdate.checkForUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            throttleMs: 30 * 60 * 1000,
            deps: { npmView, now },
        });
        expect(res.skippedReason).toBe('throttled');
        expect(npmView).not.toHaveBeenCalled();
    });

    it('degrades silently when the registry is unreachable', async () => {
        const npmView = npmViewReturning(null);
        const res = await autoUpdate.checkForUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            deps: { npmView, now },
        });
        expect(res.skippedReason).toBe('no-registry');
        expect(res.ranCheck).toBe(true);
        expect(autoUpdate.readState(stateDir).pendingUpdate).toBeNull();
        // still records the timestamp so we don't hammer the registry
        expect(autoUpdate.readState(stateDir).lastUpdateCheckedAt).toBe(FIXED_NOW);
    });
});

describe('cli/auto-update — applyPendingUpdate (foreground install)', () => {
    let stateDir: string;
    beforeEach(() => { stateDir = freshStateDir(); });
    afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

    const stagePending = (version: string, channel = 'production') =>
        autoUpdate.writeState({ pendingUpdate: { version, channel, detectedAt: FIXED_NOW } }, stateDir);

    it('is a no-op when nothing is pending', async () => {
        const res = await autoUpdate.applyPendingUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            deps: { installRunner: runnerExiting(0), now },
        });
        expect(res.applied).toBe(false);
        expect(res.reason).toBe('no-pending');
    });

    it('installs a pending update, clears the flag, and reports success', async () => {
        stagePending('1.0.22');
        const installRunner = runnerExiting(0);
        const res = await autoUpdate.applyPendingUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            deps: { installRunner, now },
        });
        expect(res).toMatchObject({ applied: true, succeeded: true, targetVersion: '1.0.22' });
        expect(installRunner).toHaveBeenCalledWith(PKG, 'latest', expect.any(Number));

        const state = autoUpdate.readState(stateDir);
        expect(state.pendingUpdate).toBeNull();
        expect(state.installedVersion).toBe('1.0.22');
        // a log file was written
        expect(existsSync(autoUpdate.installLogPath(stateDir))).toBe(true);
    });

    it('installs a beta pending update from the beta tag', async () => {
        stagePending('1.0.22-beta.1', 'beta');
        const installRunner = runnerExiting(0);
        await autoUpdate.applyPendingUpdate({
            packageName: PKG, currentVersion: '1.0.22-beta.0', stateDir,
            deps: { installRunner, now },
        });
        expect(installRunner).toHaveBeenCalledWith(PKG, 'beta', expect.any(Number));
    });

    it('clears the flag without installing when already at/after the target', async () => {
        stagePending('1.0.22');
        const installRunner = runnerExiting(0);
        const res = await autoUpdate.applyPendingUpdate({
            packageName: PKG, currentVersion: '1.0.30', stateDir,
            deps: { installRunner, now },
        });
        expect(res.reason).toBe('already-current');
        expect(installRunner).not.toHaveBeenCalled();
        expect(autoUpdate.readState(stateDir).pendingUpdate).toBeNull();
    });

    it('records a failure and backs off on a non-zero install exit', async () => {
        stagePending('1.0.22');
        const res = await autoUpdate.applyPendingUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            deps: { installRunner: runnerExiting(1), now },
        });
        expect(res).toMatchObject({ applied: true, succeeded: false, reason: 'install-failed' });
        const state = autoUpdate.readState(stateDir);
        expect(state.lastInstallFailureAt).toBe(FIXED_NOW);
        expect(state.pendingUpdate).not.toBeNull(); // stays pending for a later retry
    });

    it('backs off after a recent failure (no install attempt)', async () => {
        autoUpdate.writeState({
            pendingUpdate: { version: '1.0.22', channel: 'production', detectedAt: FIXED_NOW },
            lastInstallFailureAt: FIXED_NOW - 1000, // 1s ago, inside the 10-min back-off
        }, stateDir);
        const installRunner = runnerExiting(0);
        const res = await autoUpdate.applyPendingUpdate({
            packageName: PKG, currentVersion: '1.0.21', stateDir,
            deps: { installRunner, now },
        });
        expect(res.reason).toBe('backoff');
        expect(installRunner).not.toHaveBeenCalled();
    });

    it('does nothing inside a re-exec (guards against recursion)', async () => {
        stagePending('1.0.22');
        const prev = process.env[autoUpdate.REEXEC_ENV_FLAG];
        process.env[autoUpdate.REEXEC_ENV_FLAG] = '1';
        try {
            const installRunner = runnerExiting(0);
            const res = await autoUpdate.applyPendingUpdate({
                packageName: PKG, currentVersion: '1.0.21', stateDir,
                deps: { installRunner, now },
            });
            expect(res.reason).toBe('reexec');
            expect(installRunner).not.toHaveBeenCalled();
        } finally {
            if (prev === undefined) delete process.env[autoUpdate.REEXEC_ENV_FLAG];
            else process.env[autoUpdate.REEXEC_ENV_FLAG] = prev;
        }
    });
});

describe('cli/auto-update — runUpdate (appx-core update)', () => {
    let stateDir: string;
    beforeEach(() => { stateDir = freshStateDir(); });
    afterEach(() => { rmSync(stateDir, { recursive: true, force: true }); });

    it('reports up-to-date without installing', async () => {
        const installRunner = runnerExiting(0);
        const res = await autoUpdate.runUpdate(
            { stateDir, deps: { npmView: npmViewReturning('1.0.21'), installRunner, now } },
            { packageName: PKG, currentVersion: '1.0.21' },
        );
        expect(res).toMatchObject({ updated: false, reason: 'up-to-date' });
        expect(installRunner).not.toHaveBeenCalled();
    });

    it('installs a newer version and clears any pending flag', async () => {
        autoUpdate.writeState({ pendingUpdate: { version: '1.0.22', channel: 'production', detectedAt: FIXED_NOW } }, stateDir);
        const installRunner = runnerExiting(0);
        const res = await autoUpdate.runUpdate(
            { stateDir, deps: { npmView: npmViewReturning('1.0.25'), installRunner, now } },
            { packageName: PKG, currentVersion: '1.0.21' },
        );
        expect(res).toMatchObject({ updated: true, latestVersion: '1.0.25' });
        expect(installRunner).toHaveBeenCalledWith(PKG, 'latest', expect.any(Number));
        expect(autoUpdate.readState(stateDir).pendingUpdate).toBeNull();
    });

    it('honours an explicit --channel beta override', async () => {
        const npmView = npmViewReturning('1.0.30-beta.2');
        const installRunner = runnerExiting(0);
        await autoUpdate.runUpdate(
            { channel: 'beta', stateDir, deps: { npmView, installRunner, now } },
            { packageName: PKG, currentVersion: '1.0.21' },
        );
        expect(npmView).toHaveBeenCalledWith(PKG, 'beta');
        expect(installRunner).toHaveBeenCalledWith(PKG, 'beta', expect.any(Number));
    });
});
