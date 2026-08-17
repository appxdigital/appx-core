/**
 * Jest configuration for @appxdigital/appx-core.
 *
 * Test layout:
 *   test/**\/*.spec.ts          — all tests (unit + integration)
 *
 * Integration tests rely on Docker via testcontainers. Run with:
 *   npm test                         (defaults to mysql)
 *   DB_PROVIDER=mysql    npm test    (explicit)
 *   DB_PROVIDER=postgres npm test    (postgres)
 *   npm run test:all                 (sequential: mysql then postgres)
 */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '.',
    roots: ['<rootDir>/test'],
    testMatch: ['**/*.spec.ts'],
    // The scaffold-app fixture ships its own vitest suite (copied from
    // cli/scaffold/test/) — jest must not try to run those specs.
    testPathIgnorePatterns: ['/node_modules/', '/fixtures/scaffold-app/'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    transform: {
        // diagnostics: false — type-checking of framework source happens at
        // build time (npm run build). ts-jest only needs to transpile here;
        // strict typing on internal fields like Prisma's _runtimeDataModel
        // would otherwise break test runs that successfully compile in prod.
        '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.test.json', diagnostics: false }],
    },
    // The framework eagerly require()s adminjs and @adminjs/prisma at module
    // load time. Both are pure ESM and jest's VM can't load them (works in
    // plain Node thanks to require(esm) since 20.19, but jest doesn't honour
    // it). Map both to local CJS stubs so the framework barrel can be required.
    // See for the underlying source bug.
    moduleNameMapper: {
        '^adminjs$': '<rootDir>/test/mocks/adminjs.cjs',
        '^@adminjs/prisma/lib/Property$': '<rootDir>/test/mocks/adminjs-prisma-property.cjs',
    },
    globalSetup: '<rootDir>/test/jest.global-setup.ts',
    globalTeardown: '<rootDir>/test/jest.global-teardown.ts',
    // Deterministic order; keeps the heavy create-parity E2E last so it can't
    // perturb the shared-container HTTP specs. See the sequencer for details.
    testSequencer: '<rootDir>/test/helpers/test-sequencer.cjs',
    testTimeout: 120_000,   // first run pulls images; container boot ~30s
    // Sequential execution: every spec talks to the same DB pair (appx_proxy,
    // appx_fixture). Parallel workers would race on shared state — see the
    // pollution we hit when and ran simultaneously.
    maxWorkers: 1,
    verbose: false,
    detectOpenHandles: false,
    forceExit: true,
};
