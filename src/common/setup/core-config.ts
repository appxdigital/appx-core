/**
 * Boot-time configuration helpers used by the scaffold's `main.ts` /
 * `app.module.ts`. They fail fast on insecure or ambiguous configuration
 * instead of silently falling back.
 */

/** Minimum length we require of a session signing secret. */
export const MIN_SESSION_SECRET_LENGTH = 32;

export interface CoreSessionOptionsInput {
    /** The session signing secret. Required — no fallback. */
    secret?: string;
    /** The express-session store (e.g. `CorePrismaSessionStore`). */
    store: any;
    /** Cookie name. */
    cookieName?: string;
    /** Session TTL in seconds (drives cookie `maxAge`). Default 86400. */
    ttlSeconds?: number;
    /**
     * Force the `Secure` cookie flag. Defaults to `true` in production
     * (`NODE_ENV === 'production'`), `false` otherwise so local HTTP dev works.
     */
    secure?: boolean;
    /** `SameSite` policy. Default `'lax'`. */
    sameSite?: boolean | 'lax' | 'strict' | 'none';
}

/**
 * Builds hardened `express-session` options.
 *
 * - **:** throws if `secret` is missing or shorter than
 *   {@link MIN_SESSION_SECRET_LENGTH}. There is no hardcoded fallback — a
 *   missing secret must stop the boot, never silently sign sessions with a
 *   public constant.
 * - **:** sets `cookie: { httpOnly, secure, sameSite, maxAge }` so session
 *   cookies are not readable by JS, are `Secure` in production, and carry a
 *   `SameSite` policy.
 *
 * Pass the result straight to `session(...)`.
 */
export function buildCoreSessionOptions(input: CoreSessionOptionsInput) {
    const {secret, store, cookieName, ttlSeconds = 86400, secure, sameSite = 'lax'} = input;

    if (!secret || secret.length < MIN_SESSION_SECRET_LENGTH) {
        throw new Error(
            `SESSION_SECRET must be set and at least ${MIN_SESSION_SECRET_LENGTH} characters. ` +
            'Refusing to start with a missing or weak session secret.',
        );
    }

    return {
        secret,
        resave: false,
        saveUninitialized: false,
        name: cookieName,
        store,
        cookie: {
            httpOnly: true,
            secure: secure ?? process.env.NODE_ENV === 'production',
            sameSite,
            maxAge: ttlSeconds * 1000,
        },
    };
}

/**
 * Resolves the env file paths for `ConfigModule.forRoot({ envFilePath })`.
 *
 * Returns `['.env.<NODE_ENV>', '.env']`. `ConfigModule` gives the **first**
 * existing file precedence, so environment-specific values in `.env.<NODE_ENV>`
 * win, and a plain `.env` (what `appx-core create` generates) is loaded as a
 * base/fallback. Without the `.env` fallback a freshly scaffolded project —
 * which ships only `.env` — would load nothing and then fail the * `SESSION_SECRET` check at boot.
 *
 * **:** throws if `NODE_ENV` is unset instead of silently defaulting to
 * `development` — a production deploy that forgets `NODE_ENV` must fail fast
 * rather than load `.env.development` (dev DB creds, loose CORS, insecure
 * cookies). Set `NODE_ENV` explicitly (`production` / `development` / `test`).
 */
export function coreEnvFilePath(): string[] {
    const env = process.env.NODE_ENV;
    if (!env) {
        throw new Error(
            'NODE_ENV must be explicitly set (e.g. "production" or "development"). ' +
            'Refusing to default to development.',
        );
    }
    return [`.env.${env}`, '.env'];
}
