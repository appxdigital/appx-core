/**
 * AppX Core CLI — self-update.
 *
 * Two-phase, race-safe update flow (modelled on the same design used by
 * the AppXCode CLI):
 *
 *   Invocation N (any command, background):
 *     - `checkForUpdate` queries the npm registry on a throttled
 *       schedule. When a newer version is published on the running
 *       channel it writes a `pendingUpdate` flag to
 *       ~/.appx-core/state.json — it does NOT install during a running
 *       process (a background `npm install -g` would rewrite the
 *       package directory while another `appx-core` invocation is
 *       loading files from it).
 *
 *   Invocation N+1 (any command, BEFORE user work):
 *     - `applyPendingUpdate` reads the flag, takes a PID-based install
 *       lock, runs `npm install -g <pkg>@<tag>` foreground with
 *       stdout/stderr captured to ~/.appx-core/last-install.log, then
 *       clears the flag. The caller (cli.js) re-execs into the freshly
 *       installed binary so the user's command runs the new code.
 *
 * Channel: inferred from the *installed* version. A pre-release suffix
 * (e.g. `1.0.22-beta.0`) → the `beta` dist-tag; a clean semver → the
 * `latest` (production) dist-tag. `appx-core update --channel beta`
 * installs a beta build; the next invocation's version then carries the
 * channel forward on its own — no channel state to persist.
 *
 * This module is CommonJS on purpose: the ESM `cli.js` imports it as a
 * default import, and the jest (CommonJS) unit suite `require()`s it
 * directly. Every subprocess touchpoint (registry read, install) is
 * injectable via `deps` so the tests never hit the network or npm.
 *
 * Opt out entirely with `APPX_CORE_NO_AUTO_UPDATE=1`.
 */

'use strict';

const {
    existsSync,
    mkdirSync,
    openSync,
    closeSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
} = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const semver = require('semver');

const execFileP = promisify(execFile);

// ─── Constants ───────────────────────────────────────────────────────

const DEFAULT_THROTTLE_MS = 30 * 60 * 1000; // 30 minutes
const FAILURE_BACKOFF_MS = 10 * 60 * 1000; // suppress retries 10 min after a failed install
const LOCK_STALE_AFTER_MS = 10 * 60 * 1000; // an install older than this is presumed dead
const NPM_VIEW_TIMEOUT_MS = 15_000;
const NPM_INSTALL_TIMEOUT_MS = 5 * 60_000; // first global install can be slow
const ENV_DISABLE = 'APPX_CORE_NO_AUTO_UPDATE';
const STATE_DIR_NAME = '.appx-core';
const STATE_FILE_NAME = 'state.json';
const LOCK_FILE_NAME = 'install.lock';
const LOG_FILE_NAME = 'last-install.log';

/** Internal env flag set on re-exec so the child skips the update path. */
const REEXEC_ENV_FLAG = 'APPX_CORE_REEXEC';

// ─── Channel ─────────────────────────────────────────────────────────

/**
 * Infer the release channel from a semver string. Any pre-release
 * suffix → 'beta'; a clean release → 'production'.
 */
function inferChannel(version) {
    return semver.prerelease(version) ? 'beta' : 'production';
}

/** Map a channel to its npm dist-tag. */
function channelTag(channel) {
    return channel === 'beta' ? 'beta' : 'latest';
}

/**
 * Compare two semver strings: -1 / 0 / 1. Delegates to `semver` so
 * pre-release identifiers compare per spec (numeric segments
 * numerically) — a hand-rolled lexical compare breaks at every
 * digit-width jump (`beta.9` → `beta.10`).
 */
function compareVersions(a, b) {
    return semver.compare(a, b);
}

// ─── State ───────────────────────────────────────────────────────────

function defaultStateDir() {
    return join(homedir(), STATE_DIR_NAME);
}

function stateFilePath(stateDir) {
    return join(stateDir, STATE_FILE_NAME);
}

function defaultState() {
    return {
        installedVersion: null,
        lastUpdateCheckedAt: null,
        pendingUpdate: null,
        lastInstallFailureAt: null,
    };
}

function readState(stateDir) {
    const path = stateFilePath(stateDir);
    if (!existsSync(path)) return defaultState();
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf-8'));
        return { ...defaultState(), ...parsed };
    } catch {
        // Corrupt state file: behave as if fresh. Never crash the user's
        // command over a bad ~/.appx-core/state.json.
        return defaultState();
    }
}

function writeState(state, stateDir) {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    writeFileSync(stateFilePath(stateDir), JSON.stringify(state, null, 2) + '\n', 'utf-8');
}

// ─── npm subprocess wrappers (injectable via deps) ───────────────────

/**
 * `npm view <pkg>@<tag> version --json`. Returns the version string, or
 * null when the tag isn't published, npm isn't on PATH, or the network /
 * auth fails — the caller must degrade silently, never block a command.
 */
async function realNpmView(packageName, tag) {
    try {
        const { stdout } = await execFileP(
            'npm',
            ['view', `${packageName}@${tag}`, 'version', '--json'],
            { timeout: NPM_VIEW_TIMEOUT_MS },
        );
        const trimmed = stdout.trim();
        if (!trimmed) return null;
        const parsed = JSON.parse(trimmed);
        // `npm view … version --json` returns a bare string for a single
        // matched version, or an array of strings when the tag resolves
        // to several — take the highest.
        if (typeof parsed === 'string') return parsed;
        if (Array.isArray(parsed) && parsed.length) {
            return parsed
                .filter((v) => typeof v === 'string')
                .sort(semver.compare)
                .pop() ?? null;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Foreground `npm install -g <pkg>@<tag>`, piping output to `logFd`.
 * Resolves with the exit code (never rejects).
 */
function realInstallRunner(packageName, tag, logFd) {
    return new Promise((resolve) => {
        const child = spawn('npm', ['install', '-g', `${packageName}@${tag}`], {
            stdio: ['ignore', logFd, logFd],
            timeout: NPM_INSTALL_TIMEOUT_MS,
        });
        child.on('error', () => resolve({ exitCode: 1 }));
        child.on('exit', (code) => resolve({ exitCode: code ?? 1 }));
    });
}

function makeDeps(deps) {
    return {
        npmView: (deps && deps.npmView) || realNpmView,
        installRunner: (deps && deps.installRunner) || realInstallRunner,
        now: (deps && deps.now) || (() => Date.now()),
    };
}

// ─── Background detection ────────────────────────────────────────────

/**
 * Throttled registry check. Fire-and-forget from the CLI entry point.
 * DETECTS a newer version and records a `pendingUpdate` flag; the actual
 * install runs on the next invocation via `applyPendingUpdate`. Never
 * throws — any failure resolves to a skip.
 *
 * @returns {Promise<{ranCheck:boolean, newerAvailable:boolean, latestVersion:(string|null), pending:boolean, skippedReason?:string}>}
 */
async function checkForUpdate(opts) {
    const stateDir = opts.stateDir || defaultStateDir();
    const throttleMs = opts.throttleMs != null ? opts.throttleMs : DEFAULT_THROTTLE_MS;
    const { npmView, now } = makeDeps(opts.deps);
    const channel = opts.channel || inferChannel(opts.currentVersion);

    const base = { ranCheck: false, newerAvailable: false, latestVersion: null, pending: false };

    if (process.env[ENV_DISABLE] === '1') {
        return { ...base, skippedReason: 'disabled-env' };
    }

    const state = readState(stateDir);
    state.installedVersion = opts.currentVersion;

    const t = now();
    if (
        throttleMs > 0 &&
        state.lastUpdateCheckedAt !== null &&
        t - state.lastUpdateCheckedAt < throttleMs
    ) {
        return { ...base, skippedReason: 'throttled' };
    }

    const latest = await npmView(opts.packageName, channelTag(channel));
    state.lastUpdateCheckedAt = t;

    if (!latest || !semver.valid(latest)) {
        // npm missing, offline, auth bad, or nothing published — record
        // the timestamp so we don't hammer the registry, then bail.
        writeState(state, stateDir);
        return { ...base, ranCheck: true, skippedReason: 'no-registry' };
    }

    const newerAvailable = compareVersions(opts.currentVersion, latest) < 0;
    if (newerAvailable) {
        state.pendingUpdate = { version: latest, channel, detectedAt: t };
    }
    writeState(state, stateDir);

    return {
        ranCheck: true,
        newerAvailable,
        latestVersion: latest,
        pending: newerAvailable,
    };
}

// ─── Install lock ────────────────────────────────────────────────────

function lockPath(stateDir) {
    return join(stateDir, LOCK_FILE_NAME);
}

function installLogPath(stateDir) {
    return join(stateDir || defaultStateDir(), LOG_FILE_NAME);
}

function isLockFresh(lock, now) {
    if (typeof lock.pid !== 'number' || typeof lock.startedAt !== 'number') return false;
    if (now() - lock.startedAt > LOCK_STALE_AFTER_MS) return false;
    try {
        process.kill(lock.pid, 0); // ESRCH if the process is gone
        return true;
    } catch {
        return false;
    }
}

function acquireInstallLock(stateDir, now) {
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    const path = lockPath(stateDir);
    if (existsSync(path)) {
        try {
            const lock = JSON.parse(readFileSync(path, 'utf-8'));
            if (isLockFresh(lock, now)) return false;
        } catch {
            // Corrupt lock — treat as stale.
        }
        try { unlinkSync(path); } catch { /* race */ }
    }
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: now() }), 'utf-8');
    return true;
}

function releaseInstallLock(stateDir) {
    const path = lockPath(stateDir);
    if (!existsSync(path)) return;
    try {
        const lock = JSON.parse(readFileSync(path, 'utf-8'));
        if (lock.pid !== process.pid) return; // never delete another process's lock
    } catch {
        // Corrupt: fall through and remove.
    }
    try { unlinkSync(path); } catch { /* race */ }
}

// ─── Apply a pending update (foreground, before user work) ───────────

/**
 * Install the version staged by a previous invocation, then let the
 * caller re-exec into it. Skips cleanly (never throws) when there's
 * nothing pending, the target is already installed, another process
 * holds the lock, or we're inside a back-off window after a failure.
 *
 * @returns {Promise<{applied:boolean, succeeded:boolean, reason?:string, targetVersion?:string, logPath:string}>}
 */
async function applyPendingUpdate(opts) {
    const stateDir = opts.stateDir || defaultStateDir();
    const { installRunner, now } = makeDeps(opts.deps);
    const logPath = installLogPath(stateDir);

    // Re-exec'd children never apply — that would recurse.
    if (process.env[REEXEC_ENV_FLAG]) {
        return { applied: false, succeeded: false, reason: 'reexec', logPath };
    }

    const state = readState(stateDir);
    const pending = state.pendingUpdate;
    if (!pending) {
        return { applied: false, succeeded: false, reason: 'no-pending', logPath };
    }

    // Already at/after the target (e.g. the user upgraded by hand): clear.
    if (compareVersions(opts.currentVersion, pending.version) >= 0) {
        state.pendingUpdate = null;
        state.lastInstallFailureAt = null;
        writeState(state, stateDir);
        return { applied: false, succeeded: false, reason: 'already-current', logPath };
    }

    // Back off after a recent failure so we don't hammer a broken setup.
    if (
        state.lastInstallFailureAt !== null &&
        now() - state.lastInstallFailureAt < FAILURE_BACKOFF_MS
    ) {
        return { applied: false, succeeded: false, reason: 'backoff', targetVersion: pending.version, logPath };
    }

    if (!acquireInstallLock(stateDir, now)) {
        return { applied: false, succeeded: false, reason: 'lock-held', targetVersion: pending.version, logPath };
    }

    try {
        process.stderr.write(`⏳  Updating appx-core CLI to ${pending.version}…\n`);
        const logFd = openSync(logPath, 'w');
        let result;
        try {
            result = await installRunner(opts.packageName, channelTag(pending.channel), logFd);
        } finally {
            try { closeSync(logFd); } catch { /* already closed */ }
        }

        if (result.exitCode === 0) {
            state.pendingUpdate = null;
            state.lastInstallFailureAt = null;
            state.installedVersion = pending.version;
            writeState(state, stateDir);
            process.stderr.write(`✅  Updated appx-core CLI to ${pending.version}.\n`);
            return { applied: true, succeeded: true, targetVersion: pending.version, logPath };
        }

        state.lastInstallFailureAt = now();
        writeState(state, stateDir);
        process.stderr.write(
            `⚠  appx-core CLI update to ${pending.version} failed (exit ${result.exitCode}). See ${logPath}.\n`,
        );
        return { applied: true, succeeded: false, reason: 'install-failed', targetVersion: pending.version, logPath };
    } finally {
        releaseInstallLock(stateDir);
    }
}

// ─── `appx-core update` (foreground, user-triggered) ─────────────────

/**
 * Foreground self-update. Bypasses the throttle and installs
 * immediately and visibly. `--channel beta|production` switches
 * channels (the installed suffix carries it forward afterwards).
 */
async function runUpdate(opts, deps) {
    const stateDir = (opts && opts.stateDir) || defaultStateDir();
    const { npmView, installRunner, now } = makeDeps(opts && opts.deps);
    const channel = (opts && opts.channel) || inferChannel(deps.currentVersion);
    const tag = channelTag(channel);

    process.stdout.write('Checking for updates…\n');

    const latest = await npmView(deps.packageName, tag);
    if (!latest || !semver.valid(latest)) {
        process.stderr.write(
            'Could not query the registry. Check that `npm` is on PATH and that you can reach it.\n',
        );
        process.exitCode = 1;
        return { updated: false, reason: 'no-registry' };
    }

    if (compareVersions(deps.currentVersion, latest) >= 0) {
        process.stdout.write(`Already on the latest ${channel} version (v${deps.currentVersion}).\n`);
        return { updated: false, reason: 'up-to-date', latestVersion: latest };
    }

    const logPath = installLogPath(stateDir);
    process.stdout.write(`Updating appx-core CLI ${deps.currentVersion} → ${latest} (${channel})…\n`);
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    const logFd = openSync(logPath, 'w');
    let result;
    try {
        result = await installRunner(deps.packageName, tag, logFd);
    } finally {
        try { closeSync(logFd); } catch { /* already closed */ }
    }

    if (result.exitCode !== 0) {
        process.stderr.write(`Update failed (exit ${result.exitCode}). See ${logPath}.\n`);
        process.exitCode = 1;
        return { updated: false, reason: 'install-failed', latestVersion: latest };
    }

    // Clear any pending flag — we just installed the newest version.
    const state = readState(stateDir);
    state.pendingUpdate = null;
    state.lastInstallFailureAt = null;
    state.installedVersion = latest;
    state.lastUpdateCheckedAt = now();
    writeState(state, stateDir);

    process.stdout.write(`✅  Updated to v${latest}.\n`);
    return { updated: true, latestVersion: latest };
}

module.exports = {
    // wiring
    checkForUpdate,
    applyPendingUpdate,
    runUpdate,
    // helpers (also exercised by the unit suite)
    inferChannel,
    channelTag,
    compareVersions,
    readState,
    writeState,
    installLogPath,
    // constants callers may want
    REEXEC_ENV_FLAG,
    ENV_DISABLE,
    DEFAULT_THROTTLE_MS,
};
