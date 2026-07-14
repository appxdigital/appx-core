# Changelog

All notable changes to `@appxdigital/appx-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows the `MAJOR.MINOR.PATCH` scheme in `package.json`.

## How to read this file

- **Every released version has a section.** Newest first.
- **Changes that require action in an existing project are listed under `### Migration`** — copy-paste ready, small enough to hand to an AI coding agent. Items outside that block are drop-in.
- **Scaffold-only changes** (files under `cli/scaffold/`) affect *new* projects created with `appx-core create`. Existing projects own their copies of those files and apply the migration by hand.

---

## [0.1.121] — 2026-07-14

Hardening release: request validation, boot configuration, generated-CRUD DTOs, and data-access create enforcement.

### Added

- **`setupCoreSecurity(app, options?)`** — one call that applies baseline HTTP hardening: a global `ValidationPipe` (`{ transform: true, whitelist: true, forbidNonWhitelisted: true }`), CORS (`cors` option, default `{ origin: 'http://localhost:3000', credentials: true }`, throws if `origin: '*'` is combined with `credentials: true`), and **Helmet** security headers (on by default; `helmet` option to tune/disable). `helmet` is a new peer dependency.
- **`buildCoreSessionOptions({ secret, store, cookieName?, ttlSeconds?, secure?, sameSite? })`** — builds hardened `express-session` options. Throws if `secret` is missing or `< 32` chars (no fallback); sets `cookie: { httpOnly, secure (prod), sameSite: 'lax', maxAge }`.
- **`coreEnvFilePath()`** — returns `['.env.${NODE_ENV}', '.env']` (env-specific file wins, plain `.env` is a fallback) and throws if `NODE_ENV` is unset.
- **Per-model DTO generation** (`appx generate`). Each model+action gets a `class-validator` DTO so generated controllers type their request body concretely and the whitelist pipe can strip unknown fields. Two files:
  - `src/generated/dto/<model>/<action>-<model>.generated.dto.ts` — base class, **always overwritten**, under the gitignored `src/generated/`. Never hand-edit.
  - `src/modules/<model>/dto/<action>-<model>.dto.ts` — a hand-owned subclass, generated **once**, for custom validation. The controller imports this.
- **`/// @NoWrite` field annotation** — excludes a field from the generated create/update DTOs (all roles). Fields annotated `/// @Role(none)` are also treated as non-writable.
- **Create-permission enforcement in the data-access proxy.** `create` / `createMany` validate that the incoming data satisfies the permission's `conditions` before insert (own-scalar fields against the data; relation conditions by looking up the referenced parent), and default-deny when the model/role has no `create` permission. A development-only warning fires when a created row would not satisfy the model's `find` conditions.
- **`restrictedFields` on `create`** in `CoreController` (previously only `update`, which also read the wrong permission key so it never applied under `updateMany`).

### Writable-field policy (generated DTOs)

A scalar field is included unless it is: the primary key (`@id`), a server-managed timestamp (`@default(now())` / `@updatedAt`), `/// @NoWrite`, or `/// @Role(none)`. Relation navigation fields are excluded; their scalar foreign keys are kept. Enums map to `@IsEnum`, scalars to the matching `@IsString`/`@IsInt`/`@IsBoolean`/`@IsNumber`/`@IsDateString`; `Json`/`Bytes` use `@Allow()`.

### Changed (scaffold — new projects only)

- `main.ts` calls `setupCoreSecurity(app, { cors: { origin: corsOrigin, credentials: true } })`, builds session options via `buildCoreSessionOptions`, and reads `CORS_ORIGIN` from config.
- `app.module.ts` uses `coreEnvFilePath()` for `envFilePath`.
- Generated `package.json` adds `helmet`; the `start` script sets `NODE_ENV=development`.
- `AuthController.getAllSessions` / `closeSpecificSession` use `@UseGuards(AuthenticatedGuard)`.

### Migration

> For existing projects. All edits are to files you own (`main.ts` / `app.module.ts` / `package.json` / your generated controllers). Safe to hand to an AI coding agent.

**1. Request validation & HTTP hardening — `src/main.ts`.**
```ts
import { setupCoreSecurity } from '@appxdigital/appx-core';
// remove: app.useGlobalPipes(new ValidationPipe({ transform: true }));
// remove: app.enableCors({ origin: 'http://localhost:3000', credentials: true });
const corsOrigin = configService.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';
setupCoreSecurity(app, { cors: { origin: corsOrigin, credentials: true } });
```
- Install Helmet: `npm install helmet@^8.0.0` (applied automatically by `setupCoreSecurity`; tune with `{ helmet: {...} }`, disable with `{ helmet: false }`).
- If you register a `ValidationPipe` with custom options, pass them through: `setupCoreSecurity(app, { validationPipe: { /* overrides */ } })`.
- With `whitelist` + `forbidNonWhitelisted`, body properties not declared on a `class-validator` DTO are rejected (`400`). Confirm every DTO declares every field it legitimately accepts before deploying.
- Set `CORS_ORIGIN` to your real front-end origin in production. Do not combine `'*'` with credentials — the helper throws at boot. For a public credential-less API pass `{ cors: { origin: '*', credentials: false } }`.

**2. Session secret & cookie flags — `src/main.ts`.**
```ts
import { buildCoreSessionOptions } from '@appxdigital/appx-core';
// replace your inline session({ secret: … }) (drop any hardcoded fallback secret) with:
app.use(session(buildCoreSessionOptions({
  secret: configService.get<string>('SESSION_SECRET'),
  cookieName: configService.get<string>('SESSION_COOKIE_NAME'),
  ttlSeconds: configService.get<number>('SESSION_TTL') || 86400,
  store: new CorePrismaSessionStore(prismaService, { ttl: sessionTTL }),
})));
```
Ensure `SESSION_SECRET` is set (≥ 32 chars) in every environment — the app now refuses to boot without it.

**3. Environment file & `NODE_ENV` — `src/app.module.ts`.**
```ts
import { coreEnvFilePath } from '@appxdigital/appx-core';
// ConfigModule.forRoot({ … envFilePath: coreEnvFilePath() })
```
Set `NODE_ENV` explicitly (`production` / `development`) in every deploy and start script — boot fails if it is unset. If you use a bare `nest start`, change it to `cross-env NODE_ENV=development nest start`. (`coreEnvFilePath()` loads `.env.<NODE_ENV>` with `.env` as a fallback, so a plain `.env` still works.)

**4. Generated-CRUD DTOs.**
```bash
npm install @appxdigital/appx-core@^0.1.121
npx appx generate
```
Then **add the DTO-typed overrides to each existing generated controller** (generated once, not overwritten):
```ts
import { Body, Param, Post, Put } from '@nestjs/common';
import { Permission } from '@appxdigital/appx-core';
import { Create<Model>Dto } from './dto/create-<model-kebab>.dto';
import { Update<Model>Dto } from './dto/update-<model-kebab>.dto';

@Post() @Permission('create')
async create(@Body() data: Create<Model>Dto) { return super.create(data as any); }

@Put(':id') @Permission('updateMany')
async update(@Param('id') id: string, @Body() data: Update<Model>Dto) { return super.update(id, data as any); }
```
(Or delete an un-customized controller and re-run `appx generate` for the new template.) Add custom validation in the hand-owned `dto/*.dto.ts` subclasses — never in the `.generated.dto.ts` base. Lock sensitive columns with `/// @NoWrite` (all roles) or `restrictedFields` on the permission (per role), then regenerate.

**5. Create-permission enforcement (behaviour change — review before upgrading).**
- Ensure every model/role that legitimately creates records has an explicit `create` permission (or `'ALL'`). Without one, create now returns `403` (previously unchecked). Internal framework flows (registration, sessions, tokens) are unaffected.
- If you supplied arbitrary values for a field a `create` condition constrains (e.g. an owner id), those requests now return `403` unless the value matches — use `setUserIdField` to have the framework set it.
- **`restrictedFields` under `updateMany` now applies** (it was a no-op before). Fields listed there are stripped on `PUT`. Remove any field that should remain writable.
