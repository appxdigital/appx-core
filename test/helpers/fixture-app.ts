import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

export const REPO_ROOT = path.resolve(__dirname, '..', '..');
export const FIXTURE_DIR = path.join(REPO_ROOT, 'test', 'fixtures', 'scaffold-app');
const INSTALL_HASH_FILE = path.join(FIXTURE_DIR, 'node_modules', '.install-hash');
const FRAMEWORK_PKG_DIR_IN_FIXTURE = path.join(FIXTURE_DIR, 'node_modules', '@appxdigital', 'appx-core');

function sh(cmd: string, cwd: string): void {
    execSync(cmd, { cwd, stdio: 'inherit' });
}

function fileHash(filePath: string): string {
    return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

/**
 * Compute a hash representing the fixture's dependency surface. If unchanged
 * between runs, we skip `npm install`. Hash sources: fixture's package.json +
 * the *parent repo's* package.json (since the framework is a file: dep, its
 * own dep changes can require a re-resolve too).
 */
function currentInstallHash(): string {
    const fixturePkg = fileHash(path.join(FIXTURE_DIR, 'package.json'));
    const repoPkg = fileHash(path.join(REPO_ROOT, 'package.json'));
    return crypto.createHash('sha256').update(fixturePkg + repoPkg).digest('hex');
}

/** Ensure the framework's dist/ is current. Cheap if up-to-date. */
export function buildFramework(): void {
    // tsc is fast on a warm build; let it self-cache via the incremental flag.
    sh('npm run build', REPO_ROOT);
}

/**
 * Install fixture deps if and only if the install hash has drifted.
 * After install, replace the @appxdigital/appx-core copy with a fresh dist
 * snapshot from the parent repo so the fixture always runs the current build.
 */
export function ensureFixtureInstalled(): void {
    const want = currentInstallHash();
    const have = fs.existsSync(INSTALL_HASH_FILE) ? fs.readFileSync(INSTALL_HASH_FILE, 'utf8').trim() : null;

    if (have !== want) {
        // eslint-disable-next-line no-console
        console.log('[fixture] (re)installing dependencies — package.json hash drifted');
        sh('npm install --no-audit --no-fund --loglevel=error', FIXTURE_DIR);
        fs.mkdirSync(path.dirname(INSTALL_HASH_FILE), { recursive: true });
        fs.writeFileSync(INSTALL_HASH_FILE, want);
    } else {
        // eslint-disable-next-line no-console
        console.log('[fixture] install cache hit — skipping npm install');
    }

    // Verify the install yielded a working view of the framework. When npm
    // resolves `file:../../..` it usually creates a symlink (free live view).
    // If it copied instead, we'd need to re-sync dist/ after every rebuild —
    // detect that case and bail loudly so we know to fix install strategy.
    verifyFrameworkLink();
}

function verifyFrameworkLink(): void {
    if (!fs.existsSync(FRAMEWORK_PKG_DIR_IN_FIXTURE)) {
        throw new Error(
            `Fixture install did not produce ${FRAMEWORK_PKG_DIR_IN_FIXTURE}. ` +
            `Check that fixture package.json declares @appxdigital/appx-core: file:../../..`,
        );
    }
    const stat = fs.lstatSync(FRAMEWORK_PKG_DIR_IN_FIXTURE);
    if (!stat.isSymbolicLink()) {
        // Modern npm symlinks `file:` deps. If yours didn't, force a fresh
        // install with the link strategy.
        throw new Error(
            `Expected ${FRAMEWORK_PKG_DIR_IN_FIXTURE} to be a symlink to the repo root, ` +
            `but it is a copy. Delete node_modules and re-install, or set ` +
            `install-links=false in npm config.`,
        );
    }
    // Through the symlink, REPO_ROOT/dist == FRAMEWORK_PKG_DIR_IN_FIXTURE/dist.
    // So as long as we rebuilt dist/ in REPO_ROOT, the fixture sees it.
    const distAcrossLink = path.join(FRAMEWORK_PKG_DIR_IN_FIXTURE, 'dist');
    if (!fs.existsSync(distAcrossLink)) {
        throw new Error('dist/ missing after build — buildFramework() did not produce output');
    }
}

/**
 * Write fixture .env with the live container URL + freshly generated secrets.
 * Overwrites any committed/leftover .env on disk.
 */
export function writeFixtureEnv(databaseUrl: string, dbProvider: 'mysql' | 'postgres'): void {
    const session = crypto.randomBytes(32).toString('hex');
    const jwt = crypto.randomBytes(32).toString('hex');
    const refresh = crypto.randomBytes(32).toString('hex');

    // Parse the testcontainer URL into individual env vars so the scaffold's
    // ConfigService picks them up the way `appx-core create` would have.
    const u = new URL(databaseUrl);
    const env = [
        `DB_HOST=${u.hostname}`,
        `DB_PORT=${u.port}`,
        `DB_USER=${decodeURIComponent(u.username)}`,
        `DB_PASSWORD=${decodeURIComponent(u.password)}`,
        `DB_NAME=${u.pathname.replace(/^\//, '')}`,
        `DB_PROVIDER=${dbProvider === 'postgres' ? 'postgresql' : 'mysql'}`,
        `DB_URL=${databaseUrl}`,
        '',
        'APP_PORT=0',
        'USE_TRANSACTION=true',
        '',
        `SESSION_SECRET=${session}`,
        'SESSION_COOKIE_NAME=session_scaffold_app',
        'SESSION_TTL=86400',
        '',
        'JWT_EXPIRES_IN=10d',
        'JWT_REFRESH_EXPIRES_IN=1y',
        `JWT_SECRET=${jwt}`,
        `JWT_REFRESH_SECRET=${refresh}`,
        '',
    ].join('\n');

    // Write ONLY `.env` — exactly what `appx-core create` emits. app.module's
    // coreEnvFilePath() resolves to ['.env.<NODE_ENV>', '.env'], so with no
    // `.env.<NODE_ENV>` present the app must fall back to `.env`. Booting the
    // HTTP suite from this single file is the end-to-end proof of that fallback
    // (the fix for the `.env` vs `.env.${NODE_ENV}` mismatch). Remove stale
    // per-env files a prior run may have written.
    fs.writeFileSync(path.join(FIXTURE_DIR, '.env'), env);
    for (const stale of ['.env.development', '.env.test', '.env.production']) {
        fs.rmSync(path.join(FIXTURE_DIR, stale), {force: true});
    }
}

/**
 * Push the fixture's schema.prisma to the live test DB and generate clients.
 * Uses prisma db push (no migrations dir) so tests stay schema-only.
 */
export function pushFixturePrisma(dbProvider: 'mysql' | 'postgres'): void {
    // The fixture schema is committed with the scaffold default
    // `provider = "mysql"`. Align the datasource provider with the chosen test
    // DB so the same fixture runs against postgres too (its `@db.Text` /
    // `@db.VarChar` native types are valid in both). Only the datasource line
    // matches — the generator `provider = "..."` values are different strings
    // and are left untouched.
    const schemaPath = path.join(FIXTURE_DIR, 'prisma', 'schema.prisma');
    const wanted = dbProvider === 'postgres' ? 'postgresql' : 'mysql';
    const schema = fs
        .readFileSync(schemaPath, 'utf8')
        .replace(/provider\s*=\s*"(?:mysql|postgresql)"/, `provider = "${wanted}"`);
    fs.writeFileSync(schemaPath, schema);

    sh(
        'npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss',
        FIXTURE_DIR,
    );
    sh('npx prisma generate --schema prisma/schema.prisma', FIXTURE_DIR);
}

/**
 * Push the (already provider-aligned) fixture schema to another database on the
 * same container — used to stand up the isolated `appx_abac` DB for the ABAC
 * relation matrix. Reuses the client generated by pushFixturePrisma; DB_URL is
 * overridden inline so the datasource points at the target DB.
 */
export function pushFixtureSchemaTo(databaseUrl: string): void {
    sh(
        `DB_URL="${databaseUrl}" npx prisma db push --schema prisma/schema.prisma --skip-generate --accept-data-loss`,
        FIXTURE_DIR,
    );
}

/**
 * Prepare the fixture's generated code. Mirrors the two-command split shipped to
 * consumers:
 *   1. the deploy-safe pass (`generate-all.js`) — Prisma client + GraphQL
 *      artifacts + DTO bases, no code mutation; then
 *   2. the module wizard (`generate-models.js --all`) — scaffolds a CRUD module
 *      for every generatable (non-framework) model and registers it in
 *      AppModule, non-interactively.
 * The `--all` form reproduces the old "expose every table" behaviour the ABAC
 * HTTP/proxy fixture relies on.
 */
export function runFixtureGenerate(): void {
    const configDir = path.join(FRAMEWORK_PKG_DIR_IN_FIXTURE, 'dist', 'config');
    // The wizard runs the safe pass itself, but call it explicitly first so a
    // safe-pass-only regression is visible independently of the scaffold step.
    sh(`node ${path.join(configDir, 'generate-all.js')}`, FIXTURE_DIR);
    sh(`node ${path.join(configDir, 'generate-models.js')} --all`, FIXTURE_DIR);
    // GraphQL is opt-in per module. Enable it for Project so the GraphQL ABAC
    // spec has a model to query (relations + a role-gated field to prove
    // nested/field omission). Mirrors the documented one-line opt-in.
    enableFixtureGraphql(['Project']);
}

/**
 * Turn on the per-module GraphQL opt-in for the given models by uncommenting the
 * copy-paste-ready lines the module template ships (the two imports + the
 * `CoreGraphqlResolver(...)` provider). Mirrors exactly what a developer does by
 * hand — no bespoke test wiring.
 */
export function enableFixtureGraphql(models: string[]): void {
    for (const model of models) {
        const folder = model.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
        const modulePath = path.join(FIXTURE_DIR, 'src/modules', folder, `${folder}.module.ts`);
        const src = fs
            .readFileSync(modulePath, 'utf8')
            .split('\n')
            .map((line) =>
                /^\s*\/\/\s*(import \{ \w+Resolver \} from '\.\.\/\.\.\/generated\/|\w+Resolver,)/.test(line)
                    ? line.replace(/^(\s*)\/\/\s?/, '$1')
                    : line,
            )
            .join('\n');
        fs.writeFileSync(modulePath, src);
    }
}

/**
 * Compile the fixture's TypeScript so HTTP tests can require the built
 * AppModule. Uses `tsc` directly (no nest-cli.json needed). Skipped if dist/
 * exists and is newer than every source file (cheap mtime check).
 */
export function buildFixtureApp(): void {
    const fixtureDist = path.join(FIXTURE_DIR, 'dist');
    // tsc with --build is incremental; cheap on warm runs.
    sh('npx tsc -p tsconfig.build.json', FIXTURE_DIR);
    if (!fs.existsSync(path.join(fixtureDist, 'app.module.js'))) {
        throw new Error('Fixture build did not produce app.module.js');
    }
}

/**
 * Path to the compiled AppModule for require() in HTTP tests.
 */
export const FIXTURE_APP_MODULE_PATH = path.join(FIXTURE_DIR, 'dist', 'app.module.js');
