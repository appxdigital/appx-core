import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export type DbProvider = 'mysql' | 'postgres';

export const TEST_ROOT = path.resolve(__dirname, '..');
export const RUNTIME_DIR = path.join(TEST_ROOT, 'fixtures', '.runtime');
export const SCHEMA_TEMPLATE = path.join(TEST_ROOT, 'fixtures', 'prisma', 'schema.prisma.template');
export const RUNTIME_SCHEMA = path.join(RUNTIME_DIR, 'schema.prisma');
export const CLIENT_OUTPUT = path.join(RUNTIME_DIR, 'client');

export function chosenProvider(): DbProvider {
    const v = (process.env.DB_PROVIDER || 'mysql').toLowerCase();
    if (v !== 'mysql' && v !== 'postgres' && v !== 'postgresql') {
        throw new Error(`Unsupported DB_PROVIDER: ${v} (expected mysql|postgres)`);
    }
    return v === 'postgresql' ? 'postgres' : (v as DbProvider);
}

export function prismaProvider(provider: DbProvider): string {
    return provider === 'postgres' ? 'postgresql' : 'mysql';
}

/**
 * Start a database container with THREE databases on the same instance:
 *   - appx_proxy    used by the proxy harness (test schema in test/fixtures/prisma/)
 *   - appx_fixture  used by the scaffold-app fixture (HTTP tests)
 *   - appx_parity   used by the cli/create-parity test (§5 in ROADMAP.md).
 *                   Returned URL uses ROOT credentials because `appx-core create`
 *                   runs `prisma migrate dev` which requires shadow-database
 *                   creation rights (CREATE on *.*).
 *
 * Returning multiple URLs lets each suite push its own schema without
 * trampling the others, while sharing one container for the whole run.
 */
export async function startDbContainer(provider: DbProvider): Promise<{
    proxyUrl: string;
    fixtureUrl: string;
    parityRootUrl: string;
    abacUrl: string;
    parityCreds: { host: string; port: string; user: string; password: string; dbName: string; provider: 'mysql' | 'postgresql' };
    stop: () => Promise<void>;
}> {
    if (provider === 'mysql') {
        const c: StartedMySqlContainer = await new MySqlContainer('mysql:8.0')
            .withDatabase('appx_proxy')
            .withUsername('appx')
            .withUserPassword('appx_pw')
            .withRootPassword('appx_root_pw')
            .start();

        // Create the second + third DBs and elevate the appx user to
        // *.* ALL PRIVILEGES so `prisma migrate dev` (run by appx-core
        // create) can auto-create its shadow database. Acceptable for
        // tests; real consumers grant per-database only.
        const res = await c.exec([
            'mysql', '-uroot', '-pappx_root_pw', '-e',
            "CREATE DATABASE appx_fixture; " +
            "CREATE DATABASE appx_parity; " +
            "CREATE DATABASE appx_abac; " +
            "GRANT ALL PRIVILEGES ON *.* TO 'appx'@'%' WITH GRANT OPTION; " +
            "FLUSH PRIVILEGES;",
        ]);
        if (res.exitCode !== 0) {
            throw new Error(`Failed to bootstrap databases: ${res.output}`);
        }

        const baseUri = c.getConnectionUri();        // mysql://appx:appx_pw@host:port/appx_proxy
        const host = c.getHost();
        const port = String(c.getPort());
        return {
            proxyUrl: baseUri,
            fixtureUrl: baseUri.replace(/\/appx_proxy(\?|$)/, '/appx_fixture$1'),
            parityRootUrl: `mysql://appx:appx_pw@${host}:${port}/appx_parity`,
            abacUrl: `mysql://appx:appx_pw@${host}:${port}/appx_abac`,
            parityCreds: {
                host, port, user: 'appx', password: 'appx_pw',
                dbName: 'appx_parity', provider: 'mysql',
            },
            stop: async () => { await c.stop({ timeout: 10_000 }); },
        };
    }

    const c: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('appx_proxy')
        .withUsername('appx')
        .withPassword('appx_pw')
        .start();

    // Postgres' default 'appx' user is the DB owner / has SUPERUSER in
    // testcontainers' image, so it can create databases. No separate root.
    // Each CREATE DATABASE gets its own -c: psql runs all statements in a
    // single -c string as one implicit transaction, and CREATE DATABASE cannot
    // run inside a transaction block. Separate -c flags execute independently.
    const res = await c.exec([
        'psql', '-U', 'appx', '-d', 'postgres',
        '-c', 'CREATE DATABASE appx_fixture OWNER appx;',
        '-c', 'CREATE DATABASE appx_parity OWNER appx;',
        '-c', 'CREATE DATABASE appx_abac OWNER appx;',
    ]);
    if (res.exitCode !== 0) {
        throw new Error(`Failed to bootstrap databases: ${res.output}`);
    }

    const baseUri = c.getConnectionUri();             // postgresql://appx:appx_pw@host:port/appx_proxy
    const host = c.getHost();
    const port = String(c.getPort());
    return {
        proxyUrl: baseUri,
        fixtureUrl: baseUri.replace(/\/appx_proxy(\?|$)/, '/appx_fixture$1'),
        parityRootUrl: `postgresql://appx:appx_pw@${host}:${port}/appx_parity`,
        abacUrl: `postgresql://appx:appx_pw@${host}:${port}/appx_abac`,
        parityCreds: {
            host, port, user: 'appx', password: 'appx_pw',
            dbName: 'appx_parity', provider: 'postgresql',
        },
        stop: async () => { await c.stop({ timeout: 10_000 }); },
    };
}

/**
 * Render the schema template against the chosen provider + output dir.
 * Output path is relative-to-schema for Prisma's generator block.
 */
export function renderSchema(provider: DbProvider): void {
    fs.mkdirSync(RUNTIME_DIR, { recursive: true });
    const template = fs.readFileSync(SCHEMA_TEMPLATE, 'utf8');
    const relativeOutput = path.relative(RUNTIME_DIR, CLIENT_OUTPUT).replace(/\\/g, '/');
    const rendered = template
        .replace(/\{\{DB_PROVIDER\}\}/g, prismaProvider(provider))
        .replace(/\{\{CLIENT_OUTPUT\}\}/g, './' + relativeOutput);
    fs.writeFileSync(RUNTIME_SCHEMA, rendered, 'utf8');
}

export function runPrisma(args: string[], env: NodeJS.ProcessEnv = {}): void {
    execSync(`npx prisma ${args.join(' ')}`, {
        stdio: 'inherit',
        env: { ...process.env, ...env },
        cwd: path.resolve(TEST_ROOT, '..'),
    });
}

/**
 * Push the rendered schema to the running DB and generate a client.
 * `prisma db push --skip-generate` then `prisma generate` so we can debug
 * generation failures separately.
 */
export function pushAndGenerate(databaseUrl: string): void {
    runPrisma(
        ['db', 'push', '--schema', RUNTIME_SCHEMA, '--skip-generate', '--accept-data-loss'],
        { DATABASE_URL: databaseUrl },
    );
    runPrisma(
        ['generate', '--schema', RUNTIME_SCHEMA],
        { DATABASE_URL: databaseUrl },
    );
}

/**
 * Dynamically import the generated Prisma client (path varies by run).
 */
export async function loadGeneratedClient(): Promise<any> {
    const indexPath = path.join(CLIENT_OUTPUT, 'index.js');
    if (!fs.existsSync(indexPath)) {
        throw new Error(
            `Generated Prisma client not found at ${indexPath}. ` +
            `Did jest.global-setup run? Try \`npx prisma generate --schema ${RUNTIME_SCHEMA}\`.`,
        );
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(indexPath);
}
