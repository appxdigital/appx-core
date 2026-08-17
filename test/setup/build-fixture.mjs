#!/usr/bin/env node
/**
 * Bootstraps test/fixtures/scaffold-app/ from cli/scaffold/.
 *
 * This script reproduces what `appx-core create` does, minus the parts that
 * are slow / environment-dependent / re-run by jest each test:
 *   - npm install              (jest globalSetup does this)
 *   - prisma migrate           (jest globalSetup does this against a testcontainer)
 *   - appx-core generate       (jest globalSetup does this)
 *   - git init / prettier      (irrelevant for tests)
 *
 * The committed fixture is therefore the SOURCE-FILE OUTPUT of `appx-core create`:
 *   - scaffold templates rendered against deterministic placeholders
 *   - package.json with @appxdigital/appx-core aliased to file:../../..
 *   - hand-rolled NestJS tsconfig (matches what nest schematics would produce)
 *   - .env.example with placeholders; real .env written at test time
 *
 * Re-run this script when cli/scaffold/ changes:
 *   node test/setup/build-fixture.mjs
 *
 * The intent is honest: a real CLI-create run is reproduced step-for-step on
 * the scaffold-template parts that ship to consumers. The runtime side
 * (npm install + migrate + generate) is verified at test time inside the
 * real testcontainer environment, not pre-baked.
 */

import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCAFFOLD_SRC = path.join(REPO_ROOT, 'cli', 'scaffold');
const FIXTURE_DEST = path.join(REPO_ROOT, 'test', 'fixtures', 'scaffold-app');

const PROJECT_NAME = 'scaffold-app';

// Deterministic placeholders — secrets are static so the fixture diff is stable.
// At test time, .env is REWRITTEN with the real testcontainer URL and freshly
// generated secrets; these only live in the (gitignored) .env.example fallback.
const PROJECT_CONFIG = {
    PROJECT_NAME,
    DB_PROVIDER: 'mysql',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'appx',
    DB_PASSWORD: 'appx_pw',
    DB_NAME: 'appx_test',
    SESSION_SECRET: 'PLACEHOLDER_SESSION_SECRET_OVERRIDDEN_AT_TEST_TIME',
    SESSION_COOKIE_NAME: `session_${PROJECT_NAME}`,
    JWT_SECRET: 'PLACEHOLDER_JWT_SECRET_OVERRIDDEN_AT_TEST_TIME',
    JWT_REFRESH_SECRET: 'PLACEHOLDER_JWT_REFRESH_SECRET_OVERRIDDEN_AT_TEST_TIME',
};

async function rmrf(p) {
    await fs.rm(p, { recursive: true, force: true });
}

/**
 * Mirrors cli.js setupProjectStructure: walk scaffold/, strip .template,
 * substitute {{KEY}} placeholders, write to destDir.
 */
async function copyAndReplaceTemplates(srcDir, destDir) {
    await fs.mkdir(destDir, { recursive: true });
    for (const entry of await fs.readdir(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, entry.name);
        const destName = entry.name.replace(/\.template$/, '');
        const destPath = path.join(destDir, destName);
        if (entry.isDirectory()) {
            await copyAndReplaceTemplates(srcPath, destPath);
        } else {
            let content = await fs.readFile(srcPath, 'utf-8');
            for (const [key, value] of Object.entries(PROJECT_CONFIG)) {
                content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
            }
            await fs.writeFile(destPath, content, 'utf-8');
        }
    }
}

/**
 * Mirrors cli.js createPackageJson, but with @appxdigital/appx-core aliased
 * to the local repo via file: — so the fixture imports the dist/ we just built,
 * not whatever's published on npm.
 */
async function writePackageJson() {
    const pkg = {
        name: PROJECT_NAME,
        version: '0.0.1',
        description: 'Test fixture for @appxdigital/appx-core',
        author: 'AppX Digital — generated fixture',
        private: true,
        license: 'UNLICENSED',
        scripts: {
            build: 'nest build',
            start: 'nest start',
            'start:dev': 'cross-env NODE_ENV=development nest start --watch',
            'start:prod': 'cross-env NODE_ENV=production node dist/main',
            test: 'vitest run',
            'test:watch': 'vitest',
            generate: 'appx-core generate',
        },
        dependencies: {
            // Pull from the parent repo's dist/ — see test/README.md for the rebuild flow.
            '@appxdigital/appx-core': 'file:../../..',
        },
        devDependencies: {
            '@nestjs/cli': '~11.0.0',
            'cross-env': '~10.1.0',
            // npm does NOT transitively install peer deps through a symlinked
            // file: dependency. So we explicitly pull in the build-time tools
            // the scaffold relies on. Real `appx-core create` projects get
            // these via peerDependency auto-install (npm 7+).
            'prisma': '~6.5.0',
            'prisma-nestjs-graphql': '21.1.1',
            // The scaffold's vitest devDeps (vitest, supertest, testcontainers,
            // @nestjs/testing, …) are intentionally NOT installed here. The
            // fixture's file: symlink makes the framework resolve classes from
            // the repo root's node_modules while fixture code resolves its own
            // — two Nest instances — so the scaffolded vitest suite cannot run
            // in the fixture. It runs in a real `create`d project instead
            // (create.spec.ts non-interactive E2E). Installing them here would
            // also hoist Nest versions newer than the framework's peer ranges
            // (the fixture otherwise borrows root's copies via directory
            // walk-up, which keeps type identities unified for tsc).
        },
        engines: { node: '>=20.0.0' },
    };
    await fs.writeFile(
        path.join(FIXTURE_DEST, 'package.json'),
        JSON.stringify(pkg, null, 2) + '\n',
    );
}

/**
 * Standard NestJS tsconfig. cli.js reads this from @nestjs/schematics in the
 * project's node_modules (post-install). We hand-write the equivalent so the
 * fixture is self-contained pre-install.
 */
async function writeTsConfigs() {
    const tsconfig = {
        compilerOptions: {
            module: 'commonjs',
            declaration: true,
            removeComments: true,
            emitDecoratorMetadata: true,
            experimentalDecorators: true,
            allowSyntheticDefaultImports: true,
            target: 'ES2017',
            sourceMap: true,
            outDir: './dist',
            baseUrl: './',
            incremental: true,
            skipLibCheck: true,
            strictNullChecks: false,
            noImplicitAny: false,
            strictBindCallApply: false,
            forceConsistentCasingInFileNames: false,
            noFallthroughCasesInSwitch: false,
        },
    };
    const tsconfigBuild = {
        extends: './tsconfig.json',
        exclude: ['node_modules', 'test', 'dist', '**/*spec.ts', 'vitest.config.ts'],
    };
    await fs.writeFile(
        path.join(FIXTURE_DEST, 'tsconfig.json'),
        JSON.stringify(tsconfig, null, 2) + '\n',
    );
    await fs.writeFile(
        path.join(FIXTURE_DEST, 'tsconfig.build.json'),
        JSON.stringify(tsconfigBuild, null, 2) + '\n',
    );
}

async function writeGitignore() {
    const lines = [
        '# compiled output',
        '/dist',
        '/node_modules',
        '',
        '# Logs',
        'logs',
        '*.log',
        'npm-debug.log*',
        '',
        '# OS',
        '.DS_Store',
        '',
        '# IDE',
        '/.idea',
        '/.vscode',
        '',
        '# appx-core specific',
        '.env',
        // .env is written by jest globalSetup with the live container URL +
        // freshly generated secrets (mirrors `appx-core create` output) —
        // never commit it. .env.* covers any per-env files a dev adds locally.
        '.env.*',
        '!.env.example',
        'src/generated/**',
        'src/modules/**',
        '# Rewritten by jest globalSetup every test run (pristine scaffold +',
        '# generator append). Gitignored to keep working tree clean.',
        'src/app.module.ts',
        'prisma/migrations/',
        'tmp',
        '',
    ];
    await fs.writeFile(path.join(FIXTURE_DEST, '.gitignore'), lines.join('\n'));
}

/**
 * .env.example is committed; .env is written at test time with the live
 * container URL + freshly generated secrets.
 */
async function writeEnvExample() {
    const envExample = [
        '# Copied/regenerated by jest.global-setup.ts on each test run.',
        '# Do NOT commit a real .env — secrets and DB URL are run-specific.',
        '',
        '## DataBase Configurations ##',
        `DB_HOST=${PROJECT_CONFIG.DB_HOST}`,
        `DB_PORT=${PROJECT_CONFIG.DB_PORT}`,
        `DB_USER=${PROJECT_CONFIG.DB_USER}`,
        `DB_PASSWORD=${PROJECT_CONFIG.DB_PASSWORD}`,
        `DB_NAME=${PROJECT_CONFIG.DB_NAME}`,
        `DB_PROVIDER=${PROJECT_CONFIG.DB_PROVIDER}`,
        'DB_URL="${DB_PROVIDER}://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"',
        '',
        '## Project configurations ##',
        'APP_PORT=3000',
        'USE_TRANSACTION=true',
        '',
        '## Sessions ##',
        'SESSION_SECRET="change-me-at-test-time"',
        `SESSION_COOKIE_NAME="${PROJECT_CONFIG.SESSION_COOKIE_NAME}"`,
        'SESSION_TTL=86400',
        '',
        '## JWT ##',
        'JWT_EXPIRES_IN=10d',
        'JWT_REFRESH_EXPIRES_IN=1y',
        'JWT_SECRET="change-me-at-test-time"',
        'JWT_REFRESH_SECRET="change-me-at-test-time"',
        '',
    ].join('\n');
    await fs.writeFile(path.join(FIXTURE_DEST, '.env.example'), envExample);
}

/**
 * src/modules/ is gitignored at the fixture level (every entry is generated
 * at test time). We create the empty dir here so jest's setup has a target
 * to write into. Don't add a .gitkeep — the generator iterates files in this
 * dir without checking isDirectory(), and ANY non-model
 * file (including .gitkeep) gets injected as a broken module import into
 * app.module.ts.
 */
async function ensureModulesDir() {
    const modulesDir = path.join(FIXTURE_DEST, 'src', 'modules');
    await fs.mkdir(modulesDir, { recursive: true });
}

async function main() {
    console.log(`[build-fixture] wiping ${path.relative(REPO_ROOT, FIXTURE_DEST)}`);
    await rmrf(FIXTURE_DEST);
    await fs.mkdir(FIXTURE_DEST, { recursive: true });

    console.log('[build-fixture] copying scaffold templates with placeholder substitution');
    await copyAndReplaceTemplates(SCAFFOLD_SRC, FIXTURE_DEST);

    console.log('[build-fixture] writing package.json (aliased @appxdigital/appx-core → file:../../..)');
    await writePackageJson();

    console.log('[build-fixture] writing tsconfig.json + tsconfig.build.json');
    await writeTsConfigs();

    console.log('[build-fixture] writing .gitignore');
    await writeGitignore();

    console.log('[build-fixture] writing .env.example');
    await writeEnvExample();

    console.log('[build-fixture] ensuring src/modules/ exists for generator output');
    await ensureModulesDir();

    // cli.js create runs `prettier --write .` after scaffold copy. Mirror that
    // here so the committed fixture matches what `appx-core create` actually
    // produces (ensures test/cli/create-parity.spec.ts passes byte-for-byte).
    console.log('[build-fixture] running prettier to match cli.js create output');
    const { execSync } = await import('child_process');
    execSync('npx --yes prettier --write .', {
        cwd: FIXTURE_DEST,
        stdio: ['ignore', 'ignore', 'inherit'],
    });

    console.log('[build-fixture] done.');
    console.log(`  → ${FIXTURE_DEST}`);
    console.log('  Next: jest globalSetup will run `npm install` (cached by package.json hash).');
}

main().catch((err) => {
    console.error('[build-fixture] FAILED:', err);
    process.exit(1);
});
