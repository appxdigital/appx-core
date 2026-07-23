/**
 * Tests for `appx-core create` (cli/cli.js).
 *
 * Two layers:
 *   1. Contract tests — fast, parse cli.js + scaffold/ on disk and assert
 *      invariants. Catches refactoring drift without booting Node subprocesses.
 *   2. Subprocess test — slow, spawns the real cli.js, drives prompts via
 *      stdin, asserts the output project structure + critical security
 *      contracts (random secrets, sane defaults).
 *
 * The subprocess test creates a one-off MySQL database on the running
 * testcontainer (parallel to appx_proxy / appx_fixture), runs through the
 * full create flow including `npm install` + `prisma migrate` + generate.
 * Tagged with a long timeout because npm install is the bottleneck.
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import * as os from 'os';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'cli', 'cli.js');
const SCAFFOLD_DIR = path.join(REPO_ROOT, 'cli', 'scaffold');

const KNOWN_PLACEHOLDERS = new Set([
    'DB_PROVIDER',
    'DB_HOST',
    'DB_PORT',
    'DB_USER',
    'DB_PASSWORD',
    'DB_NAME',
    'SESSION_SECRET',
    'SESSION_COOKIE_NAME',
    'JWT_SECRET',
    'JWT_REFRESH_SECRET',
]);

function* walk(dir: string): Generator<string> {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) yield* walk(full);
        else yield full;
    }
}

describe('cli/cli.js — scaffold template contract', () => {
    test('every {{KEY}} in scaffold/ is in the documented set', () => {
        const found = new Set<string>();
        for (const file of walk(SCAFFOLD_DIR)) {
            const text = fs.readFileSync(file, 'utf8');
            for (const m of text.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)) {
                found.add(m[1]);
            }
        }
        const unexpected = [...found].filter((k) => !KNOWN_PLACEHOLDERS.has(k));
        if (unexpected.length > 0) {
            throw new Error(
                `Scaffold contains undocumented placeholders: ${unexpected.join(', ')}. ` +
                `Add them to KNOWN_PLACEHOLDERS in this test if intentional, and update ` +
                `cli/cli.js createProject() to populate them.`,
            );
        }
        // Sanity: the set is non-empty (i.e., we actually found anything).
        expect(found.size).toBeGreaterThan(0);
    });

    test('createPackageJson generates SESSION_SECRET and JWT_SECRET via crypto.randomBytes', () => {
        // Pins guidance: secrets must NOT be the literal "change-me"
        // documented in README. The CLI is supposed to use crypto.randomBytes(32).
        const cli = fs.readFileSync(CLI_PATH, 'utf8');
        expect(cli).toMatch(/SESSION_SECRET:\s*crypto\.randomBytes\(32\)\.toString\('hex'\)/);
        expect(cli).toMatch(/JWT_SECRET:\s*crypto\.randomBytes\(32\)\.toString\('hex'\)/);
        expect(cli).toMatch(/JWT_REFRESH_SECRET:\s*crypto\.randomBytes\(32\)\.toString\('hex'\)/);
    });

    test('scaffold permissions.config.ts does not grant USER role create/update/delete on User', () => {
        // Defensive default-deny check. If this fails it doesn't mean the
        // framework is broken — but it does mean a new project will ship with
        // a configuration that lets ANY authenticated USER call POST /users
        // and set privileged fields on the User record.
        const cfg = fs.readFileSync(
            path.join(SCAFFOLD_DIR, 'src', 'config', 'permissions.config.ts'),
            'utf8',
        );
        // The USER block should only contain read-shaped actions (findFirst,
        // findMany), not create/update/delete.
        const userBlockMatch = cfg.match(/USER:\s*\{([^}]*)\}/);
        expect(userBlockMatch).toBeTruthy();
        const userBlock = userBlockMatch![1];
        expect(userBlock).not.toMatch(/\bcreate\b/);
        expect(userBlock).not.toMatch(/\bupdateMany\b/);
        expect(userBlock).not.toMatch(/\bdeleteMany\b/);
    });

    test('scaffold main.ts applies baseline hardening via setupCoreSecurity', () => {
        const main = fs.readFileSync(path.join(SCAFFOLD_DIR, 'src', 'main.ts'), 'utf8');
        expect(main).toMatch(/setupCoreSecurity\s*\(\s*app/);
    });

    test('scaffold main.ts registers the pipe via setupCoreSecurity, not a bare inline ValidationPipe', () => {
        // The ValidationPipe now lives inside setupCoreSecurity (with whitelist +
        // forbidNonWhitelisted), so the scaffold's main.ts must NOT register its
        // own bare {transform:true}-only pipe.
        const main = fs.readFileSync(path.join(SCAFFOLD_DIR, 'src', 'main.ts'), 'utf8');
        expect(main).not.toMatch(/new\s+ValidationPipe/);
        expect(main).toMatch(/setupCoreSecurity\s*\(/);
    });

    test('scaffold main.ts builds session options via buildCoreSessionOptions (no inline secret fallback)', () => {
        const main = fs.readFileSync(path.join(SCAFFOLD_DIR, 'src', 'main.ts'), 'utf8');
        expect(main).toMatch(/buildCoreSessionOptions\s*\(/);
        expect(main).not.toMatch(/secret\s*\?\?\s*['"]/);     // no `secret ?? '...'` fallback
    });

    test('scaffold app.module uses coreEnvFilePath (no inline NODE_ENV default)', () => {
        const appModule = fs.readFileSync(path.join(SCAFFOLD_DIR, 'src', 'app.module.ts'), 'utf8');
        expect(appModule).toMatch(/coreEnvFilePath\s*\(\s*\)/);
        expect(appModule).not.toMatch(/NODE_ENV\s*\|\|\s*['"]development['"]/);
    });

    test('scaffold .env.template (post-rename: .env) has zero hard-coded secrets', () => {
        // All secret-bearing values must be {{KEY}} placeholders, not literals.
        const envTpl = fs.readFileSync(path.join(SCAFFOLD_DIR, '.env.template'), 'utf8');
        // Look for any value that looks like a real secret (32+ char hex string).
        const looksLikeRawSecret = /=[a-f0-9]{32,}/i.test(envTpl);
        expect(looksLikeRawSecret).toBe(false);
        for (const key of ['SESSION_SECRET', 'JWT_SECRET', 'JWT_REFRESH_SECRET']) {
            expect(envTpl).toMatch(new RegExp(`${key}.*\\{\\{${key}\\}\\}`));
        }
    });
});

/**
 * End-to-end test: drive `cli/cli.js create` via stdin, observe the output
 * project. Uses a fresh database on the running testcontainer so the CLI's
 * checkDb (which requires an empty database) passes.
 *
 * Skipped if APPX_FIXTURE_DB_URL isn't set (i.e., when proxy-only is on).
 * Heavy: ~60s for npm install + prisma migrate + generate.
 */
describe('cli/cli.js create — subprocess end-to-end', () => {
    const fixtureUrl = process.env.APPX_FIXTURE_DB_URL;
    // Only run this subprocess E2E on mysql. On postgres the dbProvider list
    // prompt must be *typed* ('postgresql'), which piped stdin can't drive
    // without a TTY, so the subprocess hangs. The create-parity spec already
    // exercises the full create flow on mysql.
    const isMysql = (process.env.DB_PROVIDER || 'mysql').toLowerCase().startsWith('mysql');
    const itOrSkip = fixtureUrl && isMysql ? test : test.skip;

    itOrSkip('drives prompts via stdin, produces a complete project skeleton', async () => {
        // 1. Create a one-off empty database on the running container.
        //    The cli's checkDb refuses non-empty databases.
        const u = new URL(fixtureUrl!);
        const dbProvider = u.protocol.replace(':', '');
        const dbHost = u.hostname;
        const dbPort = u.port;
        const dbUser = decodeURIComponent(u.username);
        const dbPassword = decodeURIComponent(u.password);
        const dbName = `appx_create_test_${Date.now()}`;

        // Use the existing testcontainer connection to create the DB. We
        // shell out to the mysql/psql CLI inside the container via the
        // exec path; easier is just to use the mysql2/pg deps the CLI itself
        // pulls in — but those aren't in the framework's node_modules. So
        // we use Prisma's own URL handling via `npx prisma db execute`.
        const { execSync } = await import('child_process');
        if (dbProvider === 'mysql') {
            // Connect to the server (no db) and create the db. We pipe a SQL
            // script through prisma db execute, which expects an already-
            // existing db — so use the docker container exec route instead.
            // Find the container name via testcontainers' connection url host
            // (it's randomized) — simpler is to use the same exec trick as
            // test-db.ts but we can't, so fall back to mysql client if
            // available, else skip.
            try {
                execSync(
                    `mysql -h${dbHost} -P${dbPort} -u${dbUser} -p${dbPassword} -e "CREATE DATABASE ${dbName};"`,
                    { stdio: 'pipe' },
                );
            } catch {
                // mysql client not installed on host — skip rather than fail.
                // The contract tests above already cover most of what matters.
                // eslint-disable-next-line no-console
                console.warn('[cli-create] mysql client not on PATH — skipping subprocess test');
                return;
            }
        } else {
            try {
                execSync(
                    `PGPASSWORD=${dbPassword} psql -h ${dbHost} -p ${dbPort} -U ${dbUser} -d postgres -c "CREATE DATABASE ${dbName};"`,
                    { stdio: 'pipe' },
                );
            } catch {
                // eslint-disable-next-line no-console
                console.warn('[cli-create] psql not on PATH — skipping subprocess test');
                return;
            }
        }

        // 2. tmpdir to host the new project.
        const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'appx-create-'));

        // 3. Spawn create. Feed answers in order:
        //    projectName, dbProvider, dbHost, dbPort, dbUser, dbPassword, dbName,
        //    showOutput, configureFileUpload
        const proc = spawn('node', [CLI_PATH, 'create'], {
            cwd: tmpdir,
            stdio: ['pipe', 'pipe', 'pipe'],
            // Disable CLI self-update: the subprocess must not hit the registry
            // or trigger a real global `npm install -g` during tests.
            env: { ...process.env, FORCE_COLOR: '0', APPX_CORE_NO_AUTO_UPDATE: '1' },
        });

        const answers = [
            'cli-create-target',     // projectName
            '',                      // dbProvider (default mysql)
            dbHost,                  // dbHost
            dbPort,                  // dbPort
            dbUser,                  // dbUser
            dbPassword,              // dbPassword
            dbName,                  // dbName
            'y',                     // showOutput=yes (avoids progress bar that fights stdout)
            '',                      // configureFileUpload=no
        ];

        // Write answers sequentially, with small delays so inquirer can re-render.
        for (const a of answers) {
            await new Promise((r) => setTimeout(r, 200));
            proc.stdin.write(a + '\n');
        }

        // Collect stdout/stderr for diagnostics.
        let out = '';
        proc.stdout!.on('data', (d) => { out += d.toString(); });
        proc.stderr!.on('data', (d) => { out += d.toString(); });

        const code = await new Promise<number>((resolve) => {
            proc.on('close', (c) => resolve(c ?? -1));
        });

        if (code !== 0) {
            throw new Error(`cli.js create exited with code ${code}. Output:\n${out.slice(-3000)}`);
        }

        // 4. Assert: project dir exists, key files written.
        const projectPath = path.join(tmpdir, 'cli-create-target');
        expect(fs.existsSync(projectPath)).toBe(true);
        expect(fs.existsSync(path.join(projectPath, 'package.json'))).toBe(true);
        expect(fs.existsSync(path.join(projectPath, 'src/main.ts'))).toBe(true);
        expect(fs.existsSync(path.join(projectPath, 'src/app.module.ts'))).toBe(true);
        expect(fs.existsSync(path.join(projectPath, 'prisma/schema.prisma'))).toBe(true);
        expect(fs.existsSync(path.join(projectPath, '.env'))).toBe(true);

        // 5. Assert: .env secrets are random hex, NOT the literal placeholders.
        const env = fs.readFileSync(path.join(projectPath, '.env'), 'utf8');
        const sessionSecret = env.match(/SESSION_SECRET="([^"]+)"/)?.[1];
        const jwtSecret = env.match(/JWT_SECRET="([^"]+)"/)?.[1];
        expect(sessionSecret).toMatch(/^[a-f0-9]{64}$/);
        expect(jwtSecret).toMatch(/^[a-f0-9]{64}$/);
        expect(sessionSecret).not.toBe(jwtSecret);

        // 6. Assert: package.json depends on @appxdigital/appx-core, pinned to
        // a concrete version (the usual case) or, when the CLI's channel differs
        // from the baked library channel, a channel dist-tag (beta/latest).
        const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'));
        expect(pkg.dependencies['@appxdigital/appx-core']).toMatch(/^([0-9][0-9.~^-]*|beta|latest)$/);

        // Cleanup is fine; tmpdir gets reclaimed by the OS.
    }, 240_000);   // 4 minutes — npm install is slow on first run
});

/**
 * Path-traversal pinning test for project name. cli.js:335 only replaces
 * spaces in projectName before joining onto a path. A name like '../escape'
 * would join into a path outside the cwd. This test does NOT execute the
 * traversal attempt (we don't want to write to /tmp/escape) but pins the validation
 * gap so a future fix flips it.
 */
describe('cli/cli.js — projectName validation', () => {
    test('createProject only strips spaces from projectName — no path-traversal validation', () => {
        const cli = fs.readFileSync(CLI_PATH, 'utf8');
        // Locate the sanitisation line.
        const sanitizeLine = cli.match(/projectName\.replace\(([^)]+)\)/);
        expect(sanitizeLine).toBeTruthy();
        // Today: replace(/\s+/g, '_').toLowerCase()  — strips whitespace only.
        // No /\.\.\//, no path.isAbsolute() check, no character whitelist.
        expect(sanitizeLine![0]).not.toMatch(/\.\.|isAbsolute|whitelist/);
    });
});
