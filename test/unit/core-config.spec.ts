/**
 * Unit tests for the boot-time config helpers.
 * Loaded from the built package (dist) via the fixture's node_modules — the same
 * copy the scaffold imports.
 */
import * as path from 'path';
import { FIXTURE_DIR } from '../helpers/fixture-app';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildCoreSessionOptions, coreEnvFilePath, MIN_SESSION_SECRET_LENGTH } = require(
    path.join(FIXTURE_DIR, 'node_modules', '@appxdigital', 'appx-core'),
);

const STRONG_SECRET = 'x'.repeat(MIN_SESSION_SECRET_LENGTH);

describe('buildCoreSessionOptions — (secret enforcement)', () => {
    test('throws when secret is missing', () => {
        expect(() => buildCoreSessionOptions({ store: {} })).toThrow(/SESSION_SECRET/i);
    });

    test('throws when secret is too short', () => {
        expect(() => buildCoreSessionOptions({ secret: 'short', store: {} })).toThrow(/SESSION_SECRET/i);
    });

    test('accepts a sufficiently long secret', () => {
        const opts = buildCoreSessionOptions({ secret: STRONG_SECRET, store: {} });
        expect(opts.secret).toBe(STRONG_SECRET);
    });
});

describe('buildCoreSessionOptions — (cookie flags)', () => {
    test('sets httpOnly, sameSite, and maxAge from ttl', () => {
        const opts = buildCoreSessionOptions({ secret: STRONG_SECRET, store: {}, ttlSeconds: 100 });
        expect(opts.cookie.httpOnly).toBe(true);
        expect(opts.cookie.sameSite).toBe('lax');
        expect(opts.cookie.maxAge).toBe(100 * 1000);
        expect(opts.resave).toBe(false);
        expect(opts.saveUninitialized).toBe(false);
    });

    test('secure defaults to false outside production and can be forced', () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'development';
        try {
            expect(buildCoreSessionOptions({ secret: STRONG_SECRET, store: {} }).cookie.secure).toBe(false);
            expect(
                buildCoreSessionOptions({ secret: STRONG_SECRET, store: {}, secure: true }).cookie.secure,
            ).toBe(true);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });

    test('secure defaults to true in production', () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            expect(buildCoreSessionOptions({ secret: STRONG_SECRET, store: {} }).cookie.secure).toBe(true);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });
});

describe('coreEnvFilePath — (NODE_ENV fail-fast)', () => {
    test('throws when NODE_ENV is unset', () => {
        const prev = process.env.NODE_ENV;
        delete process.env.NODE_ENV;
        try {
            expect(() => coreEnvFilePath()).toThrow(/NODE_ENV/i);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });

    test('returns [.env.<NODE_ENV>, .env] with env-specific first (precedence) and .env as fallback', () => {
        const prev = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            // ConfigModule gives the first existing file precedence; `.env`
            // (what `create` generates) must be present as the fallback so a
            // freshly scaffolded project boots. See ROADMAP env-mismatch note.
            expect(coreEnvFilePath()).toEqual(['.env.production', '.env']);
        } finally {
            process.env.NODE_ENV = prev;
        }
    });
});
