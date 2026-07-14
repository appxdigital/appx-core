import {INestApplication, ValidationPipe, ValidationPipeOptions} from '@nestjs/common';

/**
 * Minimal CORS options accepted by {@link setupCoreSecurity}. Mirrors the
 * subset of Nest's `CorsOptions` that most apps set; extra keys are passed
 * through to `app.enableCors` untouched. Declared locally to avoid a fragile
 * deep import into Nest internals.
 */
export interface CoreCorsOptions {
    origin?: string | string[] | boolean | RegExp | (string | RegExp)[];
    credentials?: boolean;

    [key: string]: any;
}

/**
 * Options for {@link setupCoreSecurity}. Each concern can be disabled by
 * passing `false`, or tuned by passing an options object that is merged over
 * the secure defaults.
 */
export interface CoreSecurityOptions {
    /**
     * Global `ValidationPipe`. Secure default:
     * `{ transform: true, whitelist: true, forbidNonWhitelisted: true }`.
     *
     * `whitelist` strips body properties that carry no validation decorator;
     * `forbidNonWhitelisted` turns such properties into a `400` instead of
     * silently dropping them. Combined with DTOs that declare every accepted
     * field, this rejects unknown body properties on `POST /auth/register`
     * and every other class-validated request body.
     *
     * Pass `false` to skip (you must then register your own pipe), or an
     * options object to override individual flags.
     */
    validationPipe?: ValidationPipeOptions | false;

    /**
     * CORS. Default: `{ origin: 'http://localhost:3000', credentials: true }`
     * — the scaffold's historical default. Read `origin` from configuration
     * (e.g. a `CORS_ORIGIN` env var) and pass it here so the allowed origin is
     * deployment-configurable rather than hardcoded.
     *
     * Guardrail: `origin: '*'` together with `credentials: true` throws at
     * setup — that combination is rejected by browsers and is a common footgun.
     *
     * Pass `false` to skip (you manage CORS yourself).
     */
    cors?: CoreCorsOptions | false;

    /**
     * Security headers via Helmet: `Content-Security-Policy`,
     * `X-Content-Type-Options`, `Strict-Transport-Security`, frame-ancestors, etc.
     * Default: enabled with Helmet's defaults. Pass an options object to tune
     * (e.g. a custom CSP for the AdminJS UI), or `false` to skip.
     */
    helmet?: Record<string, any> | false;
}

/**
 * Applies AppX Core's baseline HTTP hardening to a Nest application.
 *
 * Call once in `main.ts`, after `NestFactory.create(...)` and before
 * `app.listen(...)`. New scaffolds call it for you; existing projects should
 * add the call when upgrading — see the CHANGELOG migration note for the
 * version that introduced each concern.
 */
export function setupCoreSecurity(
    app: INestApplication,
    options: CoreSecurityOptions = {},
): void {
    if (options.validationPipe !== false) {
        app.useGlobalPipes(
            new ValidationPipe({
                transform: true,
                whitelist: true,
                forbidNonWhitelisted: true,
                ...(options.validationPipe ?? {}),
            }),
        );
    }

    if (options.cors !== false) {
        const cors = options.cors ?? {};
        const origin = cors.origin ?? 'http://localhost:3000';
        const credentials = cors.credentials ?? true;

        if (credentials && origin === '*') {
            throw new Error(
                "setupCoreSecurity: CORS origin '*' is incompatible with credentials:true — " +
                'browsers reject it and it exposes credentialed endpoints to every origin. ' +
                'Set an explicit origin (e.g. via a CORS_ORIGIN env var) or disable credentials.',
            );
        }

        app.enableCors({...cors, origin, credentials});
    }

    if (options.helmet !== false) {
        // Lazy require: helmet is a peer dependency, only needed when enabled.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const helmet = require('helmet');
        app.use(typeof options.helmet === 'object' ? helmet(options.helmet) : helmet());
    }
}
