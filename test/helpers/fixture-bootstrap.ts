/**
 * Boot the scaffold-app fixture in-process for HTTP testing.
 *
 * Mirrors the middleware stack the scaffold's src/main.ts applies. That stack
 * is part of the security contract — finding bugs in it (cookie flags, CORS,
 * ValidationPipe whitelist) is one of the audit's goals — so we replicate
 * faithfully rather than skipping it for "test convenience."
 *
 * Tests can override individual layers (e.g., apply a HARDENED ValidationPipe
 * to prove the fix works) via the bootstrap options.
 */
import { INestApplication, ValidationPipeOptions, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as session from 'express-session';
import * as passport from 'passport';
import { FIXTURE_APP_MODULE_PATH, FIXTURE_DIR } from './fixture-app';
import * as path from 'path';

export interface BootOptions {
    /**
     * If set, applies these options to ValidationPipe instead of the scaffold
     * default `{transform: true}`. Use `{transform:true, whitelist:true,
     * forbidNonWhitelisted:true}` to test the hardened variant.
     */
    validationPipe?: ValidationPipeOptions | 'scaffold-default';

    /**
     * If true, sets up express-session + passport middleware as scaffold main.ts
     * does. Required for cookie-based login flow tests; skip for register-only
     * tests (faster boot).
     */
    enableSession?: boolean;

    /** CORS config (defaults to scaffold's hardcoded localhost:3000). */
    cors?: { origin: string; credentials?: boolean } | false;
}

export interface BootedApp {
    app: INestApplication;
    server: any;
    /**
     * Long-lived raw Prisma client. Use only for setup/teardown. Reads from
     * this client can return stale data because Prisma's connection pool
     * holds session-level snapshots in MySQL/Postgres. For test assertions
     * against the DB, call `withFreshDb()` instead.
     */
    rawPrismaClient: any;
    /**
     * Run a callback with a freshly connected Prisma client. Disconnects
     * automatically. Use this for any read-after-write assertion.
     */
    withFreshDb: <T>(fn: (client: any) => Promise<T>) => Promise<T>;
    close: () => Promise<void>;
}

export async function bootFixture(opts: BootOptions = {}): Promise<BootedApp> {
    // Required for class-validator decorators on generated/inherited DTOs.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('reflect-metadata');

    // The fixture's PrismaModule constructs `new PrismaClient()` with no
    // arguments — it reads process.env.DATABASE_URL. Jest globalSetup defaults
    // DATABASE_URL to the proxy-harness URL so the proxy-specs work; here we
    // swap it to the fixture URL so the app writes to appx_fixture.
    // Each .spec.ts file runs in its own jest worker, so the swap is local.
    if (process.env.APPX_FIXTURE_DB_URL) {
        process.env.DATABASE_URL = process.env.APPX_FIXTURE_DB_URL;
    }

    // Dynamic require so this module can be imported in test files even when
    // the fixture hasn't been built yet (globalSetup builds it before any
    // test runs). We use require, not import, to keep ts-jest from resolving
    // it at module init time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AppModule } = require(FIXTURE_APP_MODULE_PATH);

    const app = await NestFactory.create(AppModule, { logger: false });

    if (opts.enableSession) {
        const { PrismaService, CorePrismaSessionStore } = require(
            path.join(FIXTURE_DIR, 'node_modules', '@appxdigital', 'appx-core'),
        );
        const prismaService = app.get(PrismaService);
        app.use(
            session.default
                ? session.default({
                      secret: process.env.SESSION_SECRET || 'test-secret',
                      resave: false,
                      saveUninitialized: false,
                      name: process.env.SESSION_COOKIE_NAME || 'session_scaffold_app',
                      store: new CorePrismaSessionStore(prismaService, { ttl: 86400 }),
                  })
                : (session as any)({
                      secret: process.env.SESSION_SECRET || 'test-secret',
                      resave: false,
                      saveUninitialized: false,
                      name: process.env.SESSION_COOKIE_NAME || 'session_scaffold_app',
                      store: new CorePrismaSessionStore(prismaService, { ttl: 86400 }),
                  }),
        );
        // passport is a CJS default-export instance; under esModuleInterop the
        // methods live on `.default`. Mirror the `session.default` handling above.
        const passportInstance = (passport as any).default ?? (passport as any);
        app.use(passportInstance.initialize());
        app.use(passportInstance.session());
    }

    if (opts.cors !== false) {
        app.enableCors(opts.cors ?? { origin: 'http://localhost:3000', credentials: true });
    }

    // ValidationPipe: by default we use the scaffold's VULNERABLE config so
    // tests demonstrate the as-shipped behaviour. Override via opts.
    const vp =
        opts.validationPipe === undefined || opts.validationPipe === 'scaffold-default'
            ? { transform: true }
            : opts.validationPipe;
    app.useGlobalPipes(new ValidationPipe(vp));

    await app.init();

    // Connect to the same fixture DB via a raw Prisma client for assertion +
    // cleanup. The Nest app reads .env (written by globalSetup) and points at
    // appx_fixture. Our raw client must use the SAME URL or we'd be querying
    // a different database than the app writes to.
    const fixturePrisma = path.join(
        FIXTURE_DIR,
        'node_modules',
        '.prisma',
        'client',
    );
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require(fixturePrisma);
    const fixtureUrl = process.env.APPX_FIXTURE_DB_URL;
    if (!fixtureUrl) {
        throw new Error(
            'APPX_FIXTURE_DB_URL not set — jest globalSetup did not export it. ' +
            'Did you set APPX_SKIP_FIXTURE=1?',
        );
    }
    const rawPrismaClient = new PrismaClient({ datasourceUrl: fixtureUrl });
    await rawPrismaClient.$connect();

    const withFreshDb = async <T,>(fn: (client: any) => Promise<T>): Promise<T> => {
        const c = new PrismaClient({ datasourceUrl: fixtureUrl });
        await c.$connect();
        try {
            return await fn(c);
        } finally {
            await c.$disconnect();
        }
    };

    return {
        app,
        server: app.getHttpServer(),
        rawPrismaClient,
        withFreshDb,
        close: async () => {
            await rawPrismaClient.$disconnect();
            await app.close();
        },
    };
}

/**
 * Truncate every user-facing model in the fixture DB. Uses the raw client
 * (bypasses ABAC). Order respects FK dependencies.
 */
export async function resetFixtureDb(rawPrismaClient: any): Promise<void> {
    // Delete in FK-dependency order (children before parents). The domain
    // models (comment→task→projectMember→project) must be cleared before users,
    // or deleting a user that still owns a project fails the FK constraint.
    // If we add models, extend this list.
    await rawPrismaClient.comment.deleteMany({});
    await rawPrismaClient.task.deleteMany({});
    await rawPrismaClient.projectMember.deleteMany({});
    await rawPrismaClient.project.deleteMany({});
    await rawPrismaClient.userRefreshToken.deleteMany({});
    await rawPrismaClient.session.deleteMany({});
    await rawPrismaClient.user.deleteMany({});
}
