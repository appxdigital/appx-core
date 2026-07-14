/**
 * Unit tests for setupCoreSecurity — the baseline HTTP hardening helper.
 *
 * Exercises the helper against a mock Nest application (no HTTP server / DB
 * needed): asserts which pipe and CORS config it installs, and that the
 * '*'-origin + credentials footgun throws at setup.
 *
 * Loaded from the built package (dist) via the fixture's node_modules, the
 * same copy the scaffold's main.ts imports, so this pins the shipped behaviour.
 */
import * as path from 'path';
import { FIXTURE_DIR } from '../helpers/fixture-app';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { setupCoreSecurity } = require(
    path.join(FIXTURE_DIR, 'node_modules', '@appxdigital', 'appx-core'),
);

function mockApp() {
    return {
        useGlobalPipes: jest.fn(),
        enableCors: jest.fn(),
        use: jest.fn(),
    };
}

describe('setupCoreSecurity — ValidationPipe', () => {
    test('installs a ValidationPipe by default', () => {
        const app = mockApp();
        setupCoreSecurity(app);
        expect(app.useGlobalPipes).toHaveBeenCalledTimes(1);
        const pipe = app.useGlobalPipes.mock.calls[0][0];
        // The whitelist/forbidNonWhitelisted *behaviour* is proven end-to-end
        // by the HTTP spec; here we just confirm a pipe was installed.
        expect(pipe?.constructor?.name).toBe('ValidationPipe');
    });

    test('validationPipe:false skips pipe registration', () => {
        const app = mockApp();
        setupCoreSecurity(app, { validationPipe: false });
        expect(app.useGlobalPipes).not.toHaveBeenCalled();
    });
});

describe('setupCoreSecurity — CORS', () => {
    test('defaults to localhost:3000 with credentials', () => {
        const app = mockApp();
        setupCoreSecurity(app);
        expect(app.enableCors).toHaveBeenCalledTimes(1);
        expect(app.enableCors.mock.calls[0][0]).toMatchObject({
            origin: 'http://localhost:3000',
            credentials: true,
        });
    });

    test('honours a configured origin (CORS_ORIGIN passthrough)', () => {
        const app = mockApp();
        setupCoreSecurity(app, { cors: { origin: 'https://app.example.com', credentials: true } });
        expect(app.enableCors.mock.calls[0][0]).toMatchObject({
            origin: 'https://app.example.com',
            credentials: true,
        });
    });

    test("throws on origin:'*' with credentials:true (footgun guard)", () => {
        const app = mockApp();
        expect(() =>
            setupCoreSecurity(app, { cors: { origin: '*', credentials: true } }),
        ).toThrow(/incompatible with credentials/i);
    });

    test("allows origin:'*' when credentials is false", () => {
        const app = mockApp();
        setupCoreSecurity(app, { cors: { origin: '*', credentials: false } });
        expect(app.enableCors.mock.calls[0][0]).toMatchObject({
            origin: '*',
            credentials: false,
        });
    });

    test('cors:false skips enableCors', () => {
        const app = mockApp();
        setupCoreSecurity(app, { cors: false });
        expect(app.enableCors).not.toHaveBeenCalled();
    });
});

describe('setupCoreSecurity — Helmet', () => {
    test('installs helmet middleware by default', () => {
        const app = mockApp();
        setupCoreSecurity(app);
        // helmet is applied via app.use with a middleware function.
        const usedMiddleware = app.use.mock.calls.map((c: any[]) => c[0]);
        expect(usedMiddleware.some((m: any) => typeof m === 'function')).toBe(true);
    });

    test('helmet:false skips app.use', () => {
        const app = mockApp();
        setupCoreSecurity(app, { helmet: false });
        expect(app.use).not.toHaveBeenCalled();
    });
});
