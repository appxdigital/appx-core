# Changelog

All notable changes to `@appxdigital/appx-core` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows the `MAJOR.MINOR.PATCH` scheme in `package.json`.

## How to read this file

- **This file is the collapsed, production changelog** — one section per version published to the `latest` dist-tag. Granular per-build notes for `alpha`/`beta` prereleases live in [`PRERELEASES.md`](./PRERELEASES.md); the release process is documented in [`RELEASING.md`](./RELEASING.md).
- **Every released version has a section.** Newest first.
- **Changes that require action in an existing project are listed under `### Migration`** — copy-paste ready, small enough to hand to an AI coding agent. Items outside that block are drop-in.
- **Scaffold-only changes** (files under `cli/scaffold/`) affect *new* projects created with `appx-core create`. Existing projects own their copies of those files and apply the migration by hand.

---

## [0.1.124] — 2026-07-23

### Fixed

- **`appx-core generate` and `generate models` now run the project's own Prisma.** Both shelled out to a bare `prisma generate`, which resolves from `PATH`. With the CLI installed **globally** the project's `node_modules/.bin` is not on `PATH`, so Prisma resolved to a *global* install — a different version than the project's — or was not found at all. The executable is now resolved inside the project (walking up from the working directory, so hoisted / monorepo layouts work), and its `.bin` is prepended to `PATH` so the generator binaries Prisma spawns (`prisma-nestjs-graphql`, …) also resolve from the project. A project with no local Prisma now fails with an actionable message instead of silently generating against a global one.

Drop-in: no changes required in your project.

---

## [0.1.123] — 2026-07-22

Two changes: the `generate` command is split into a deploy-safe pass + a module wizard, and generated CRUD DTOs now type each scalar column to match its Prisma model type.

### Generate command split

Regenerating types no longer mutates your code.

- **`appx-core generate`** — regenerates only the overwrite-safe artifacts under the gitignored `src/generated/**` (Prisma client, GraphQL types, DTO **base** classes). It **no longer** writes `src/modules/**` or edits `src/app.module.ts`. Idempotent and safe for CI / postinstall / predeploy.
- **`appx-core generate models`** — new interactive wizard that scaffolds CRUD (module/service/controller/resolver + DTO subclass) for the models you choose and registers them in `app.module.ts`, then runs the safe pass. Non-interactive: `appx-core generate models <Name…>` and `--all`. Only models **without** an existing module are offered; if there are none it prints `No modules available to generate`.
- Model discovery is driven by the Prisma **DMMF** (the schema), not by scanning the GraphQL plugin's output folders.
- The **`User`** model is framework-owned (auth already serves user endpoints; generic User CRUD is a mass-assignment surface) and is no longer scaffolded.
- Module-registration in `app.module.ts` finds the `@Module` `imports` array's real closing bracket (skipping strings/comments/nested arrays) and **appends** there, preserving order — it no longer breaks on a nested array literal like `ThrottlerModule.forRoot([...])`, never double-registers, and never adds a duplicate import.
- "Already has a module" is detected by the model a module serves (`CoreController<Model>` / `CoreService<Model>`), not by folder name — so a hand-written module under a non-canonical (e.g. pluralised) folder isn't duplicated.
- Full reference: [`docs/generate.md`](./docs/generate.md). GraphQL stays **read-only**; every scaffolded module still gets its resolver.

### Generated-CRUD DTO scalar typing

Generated CRUD DTOs now type each scalar column to match its Prisma model type, so a controller override type-checks:

- **`DateTime` → `Date`** (was `string`), via `@Type(() => Date)`.
- **`Decimal` → `Prisma.Decimal`** (was `number`), via the new `@DecimalField()`.
- **`BigInt` → `bigint`** (was `number`), via the new `@BigIntField()`.

`@DecimalField()` / `@BigIntField()` accept a **string or number** on the wire and coerce/validate it (bad input → `400`), so there is no API change. `BigInt` columns serialize as a **string** in JSON responses (JSON has no bigint), pairing with the string-accepting input.

### Migration

> **Behaviour change — a bare `appx-core generate` no longer creates modules or edits `app.module.ts`.** Intentional (it makes the command CI-safe), but new tables are not auto-exposed.

1. Keep running `appx-core generate` after every schema change — it refreshes the Prisma client, GraphQL types and DTO bases, and is now guaranteed not to touch your committed code.
2. **To expose a new table** as CRUD, run `appx-core generate models` and pick it (or `appx-core generate models <Name>`) — the only command that scaffolds `src/modules/**` and registers a module.
3. **Existing modules are unaffected.** To reproduce the old "expose every table" behaviour in one shot, run `appx-core generate models --all`.
4. If you relied on the generated **`/users`** CRUD, it is no longer scaffolded (auth owns `/auth/*`) — re-create it by hand only if you truly need generic user CRUD.
5. **`Decimal` columns + GraphQL:** the GraphQL generator emits imports of `prisma-graphql-type-decimal` — a **peer dependency**, so `npm install` pulls it in (npm 7+ auto-installs peers); confirm with `npm ls prisma-graphql-type-decimal` if your package manager doesn't.
6. If you hand-typed an `OmitType(...)` override to re-type a `DateTime` / `Decimal` / `BigInt` field (because the old type made your controller override fail with `TS2416`), delete it, let the generated base DTO stand, and regenerate. No wire change.

---

## [0.1.122] — 2026-07-21

**No migration necessary.**

---

## [0.1.121] — 2026-07-14

Hardening release: request validation, boot configuration, generated-CRUD DTOs, and data-access create enforcement.

> ## ⚠️ REQUIRED migration — upgrading the dependency is NOT enough
>
> **This is a security release, and its protections are INERT until you adapt your codebase.** Bumping `@appxdigital/appx-core` to `0.1.121` (including any `0.1.121-beta.x`) and doing nothing else leaves your app **vulnerable** — generated `POST`/`PUT` endpoints keep accepting arbitrary fields (mass-assignment), because the request-validation DTOs only take effect once you regenerate them **and** wire them into your controllers.
>
> **You MUST complete every step in [Migration](#migration) below — this is not optional and must not be skipped.** In particular:
> - **Step 4 (generated-CRUD DTOs) is mandatory**: run `npx appx generate`, then add the DTO-typed `create`/`update` overrides to *every* existing generated controller. Generation alone does nothing; the controllers must import and use the DTOs.
> - Steps 1–3 (`main.ts` / `app.module.ts`) are required for the boot-time hardening (validation pipe, session secret, CORS, `NODE_ENV`) to apply.
> - Step 5 is a behaviour change (create is now permission-checked) — review it before deploying.
>
> **For AI agents:** do not report this upgrade as complete until steps 1–5 are applied and the app builds. If you only changed the version number, the task is unfinished.

### Added

- **`setupCoreSecurity(app, options?)`** — one call that applies baseline HTTP hardening: a global `ValidationPipe` (`{ transform: true, whitelist: true, forbidNonWhitelisted: true }`), CORS (`cors` option, default `{ origin: 'http://localhost:3000', credentials: true }`, throws if `origin: '*'` is combined with `credentials: true`), and **Helmet** security headers (on by default; `helmet` option to tune/disable). `helmet` is a new peer dependency.
- **`buildCoreSessionOptions({ secret, store, cookieName?, ttlSeconds?, secure?, sameSite? })`** — builds hardened `express-session` options. Throws if `secret` is missing or `< 32` chars (no fallback); sets `cookie: { httpOnly, secure (prod), sameSite: 'lax', maxAge }`.
- **`coreEnvFilePath()`** — returns `['.env.${NODE_ENV}', '.env']` (env-specific file wins, plain `.env` is a fallback) and throws if `NODE_ENV` is unset.
- **Per-model DTO generation** (`appx generate`). Each model+action gets a `class-validator` DTO so generated controllers type their request body concretely and the whitelist pipe can strip unknown fields. Two files:
  - `src/generated/dto/<model>/<action>-<model>.generated.dto.ts` — base class, **always overwritten**, under the gitignored `src/generated/`. Never hand-edit.
  - `src/modules/<model>/dto/<action>-<model>.dto.ts` — a hand-owned subclass, generated **once**, for custom validation. The controller imports this.
- **`/// @NoWrite` field annotation** — excludes a field from the generated create/update DTOs (all roles). Fields annotated `/// @Role(none)` are also treated as non-writable.
- **Create-permission enforcement in the data-access proxy.** `create` / `createMany` validate that the incoming data satisfies the permission's `conditions` before insert (the model's **own scalar fields** — relationship authorization is handled by the `connect` action; see Migration), and default-deny when the model/role has no `create` permission. A development-only warning fires when a created row would not satisfy the model's `find` conditions.

### Writable-field policy (generated DTOs)

A scalar field is included unless it is: the primary key (`@id`), a server-managed timestamp (`@default(now())` / `@updatedAt`), `/// @NoWrite`, or `/// @Role(none)`. Relation navigation fields are excluded; their scalar foreign keys are kept. Enums map to `@IsEnum`, scalars to the matching `@IsString`/`@IsInt`/`@IsBoolean`/`@IsNumber`/`@IsDateString`; `Json`/`Bytes` use `@Allow()`.

### Changed (scaffold — new projects only)

- `main.ts` calls `setupCoreSecurity(app, { cors: { origin: corsOrigin, credentials: true } })`, builds session options via `buildCoreSessionOptions`, and reads `CORS_ORIGIN` from config.
- `app.module.ts` uses `coreEnvFilePath()` for `envFilePath`.
- Generated `package.json` adds `helmet`; the `start` script sets `NODE_ENV=development`.
- `AuthController.getAllSessions` / `closeSpecificSession` use `@UseGuards(AuthenticatedGuard)`.
- `app.module.ts` imports `AuthModule.forRoot()` (not the bare `AuthModule`) — see the migration note below.

### Migration

> **Required for every existing project. All five steps must be applied** — the edits are to files you own (`main.ts` / `app.module.ts` / `package.json` / your generated controllers), so they are safe to hand to an AI coding agent, but they are **not optional**. The app is not secured until they are done and it builds.

**1. Request validation & HTTP hardening — `src/main.ts`.**
```ts
import { setupCoreSecurity } from '@appxdigital/appx-core';
// remove: app.useGlobalPipes(new ValidationPipe({ transform: true }));
// remove: app.enableCors({ origin: 'http://localhost:3000', credentials: true });
const corsOrigin = configService.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';
setupCoreSecurity(app, { cors: { origin: corsOrigin, credentials: true } });
```
- Helmet is applied automatically by `setupCoreSecurity` (tune with `{ helmet: {...} }`, disable with `{ helmet: false }`). It's a peer dependency, so `npm install` pulls it in for you (npm 7+ auto-installs peers) — just confirm it's present with `npm ls helmet`. Only if your package manager doesn't auto-install peers (or reports it missing) add it explicitly.
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

**4. Generated-CRUD DTOs — MANDATORY (this is the mass-assignment fix; do not skip).**

Without this step, your generated `POST`/`PUT` endpoints still accept arbitrary fields — the vulnerability this release closes stays open. Two parts, **both required**:

(a) Regenerate:
```bash
npm install @appxdigital/appx-core@^0.1.121
npx appx generate
```
(b) **Add the DTO-typed overrides to EVERY existing generated controller** (they are generated once and never overwritten, so `appx generate` will NOT add them for you — you must edit each controller by hand or delete and regenerate it):
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
(Or delete an un-customized controller and re-run `appx generate` for the new template.) Add custom validation in the hand-owned `dto/*.dto.ts` subclasses — never in the `.generated.dto.ts` base. Lock sensitive columns with `/// @NoWrite` / `/// @Role(none)` (all roles), then regenerate. To drop a field from one endpoint's DTO, extend `OmitType(<Model>GeneratedDto, ['field'] as const)`. Full details in [`docs/dtos.md`](../docs/dtos.md).

> **Nested relation writes are now an explicit, permission-gated allowlist — this is a behaviour restriction; a migrating agent MUST flag it to the developer.** Generated **create** DTOs accept only two nested operators, each authorized by ABAC: **`create`** (checked against the related model's `create` rule) and **`connect`** (checked against the related model's new dedicated **`connect`** permission — a `connect` rule is required; no rule ⇒ refused). Every other operator (`set`, `disconnect`, `update`, `upsert`, `delete`, …) is rejected (`400`). Nested writes are available on **`create` only** — `update` resolves to `updateMany`, whose payload is scalar-only. **Keep `forbidNonWhitelisted: true` on (fail loud); never `whitelist`-strip on writes.**
>
> **For AI agents doing this migration on an existing project:** this can break existing behaviour. Before deploying, tell the developer explicitly that (a) any nested operator other than `create`/`connect` used through CRUD will now `400`, (b) every model that is nested-`connect`ed now needs a `connect` permission or the request fails, and (c) nested writes no longer work on update endpoints. Do not proceed silently. See [`docs/dtos.md`](../docs/dtos.md#relations--nested-writes) and [`docs/permissions.md`](../docs/permissions.md).

> ## ⚠️ Relationship authorization moved to `connect` — this WILL break configs; the app refuses to boot until migrated
>
> **Every foreign-key reference a write establishes is now authorized by the target model's `connect` rule** — on a `create` (nested `connect`, nested `create`, **or a plain scalar FK** like `ownerId: 7`) **and on an `update` that re-points a foreign key** (`{ teacherId: 5 }` / `{ teacherId: { set: 5 } }`). A **`create` condition now judges the created model's own scalar fields only** — it must NOT reach across a relation. The one thing not re-checked is the foreign key Prisma auto-fills for a child nested inside its parent's `create` (the parent already authorized itself).
>
> **The framework validates this at boot.** If a model a role can create **or update** can set a foreign key whose target has **no `connect` rule** for that role, **the app refuses to start** (setting it would `403`). A required-on-create FK reports as such; a `@NoWrite`/`@Role(none)` FK column is exempt (it can't be written); a `create` condition that references a relation, or a relation-scoped `connect` on a non-writable field, are also boot errors.
>
> **`restrictedFields` removed.** The per-role body-strip option on a permission action (`restrictedFields: ['x']`) is gone. Migrate: mark a never-client-writable column `/// @NoWrite` (or `/// @Role(none)`); drop a field from one endpoint with `OmitType`; force an owner id with `setUserIdField`; and for a genuinely per-role write difference, use a dedicated endpoint (generic CRUD can't vary a field by role). See [`docs/dtos.md`](../docs/dtos.md#per-role-differences).
>
> **Required migration for existing projects:**
> 1. **Move relationship checks out of `create` conditions and into `connect` rules.** A rule like `ExamQuestion.create: { conditions: { exam: { course: {...} } } }` must become `Course.connect: { conditions: {...} }` (or `Exam.connect`), reached via the FK on the create. A `create` condition may only constrain the model's **own** columns (e.g. `{ ownerId: $USER_ID }`, which stays valid and is still checked).
> 2. **Add a `connect` rule to every model referenced by a foreign key on a create you allow.** For unrestricted roles that already have `create: 'ALL'`, add `connect: 'ALL'`. Start the app — the boot error lists every missing `<Model>.<Role>.connect` by name; add each until it starts. If a *specific* relation needs its own (stricter) rule — "a class's teacher must be a teacher" — declare it on the source instead: `Source[Role].relations.<field>.connect`. That also satisfies the requirement, so the target model then needs no `connect` rule for that reference.
> 3. Because one `connect` rule serves every relation that points at a model (it is keyed on `[model][role]`, not per-relation), make its conditions the **union** of what any referencing relation legitimately needs; enforce anything finer in an explicit endpoint.
>
> **For AI agents:** this is a behaviour restriction on a production app. Before deploying, tell the developer that (a) any create that sets a foreign key to a model without a `connect` rule now fails — and the app won't boot until those rules exist, and (b) any `create` condition that referenced a relation no longer enforces it there and must be re-expressed as a `connect` rule. Do not proceed silently. The boot-time error message names exactly what to add. See [`docs/permissions.md`](../docs/permissions.md#the-connect-action--authorizes-every-relationship-a-create-establishes).

**6. Auth module — `AuthModule` → `AuthModule.forRoot()` (`src/app.module.ts`).**
The bare `AuthModule` no longer registers anything; wire it as `AuthModule.forRoot()`
(all providers + the built-in `/auth` controller). This exists so the controller
can be conditionally omitted: to override the auth endpoints (e.g. widen
registration to accept `name`), import `AuthModule.forRoot({ controller: false })`
and register your own controller that `extends AuthController` at the same `/auth`
prefix. The auth building blocks (`AuthController`, `AuthService`, `RegisterDto`,
`UserDto`, the Passport strategies, guards) are now exported from the package root
— stop importing them from `@appxdigital/appx-core/dist/...`. Full guide:
[`docs/authentication.md`](../docs/authentication.md).

**5. Create-permission enforcement (behaviour change — review before upgrading).**
- Ensure every model/role that legitimately creates records has an explicit `create` permission (or `'ALL'`). Without one, create now returns `403` (previously unchecked). Internal framework flows (registration, sessions, tokens) are unaffected.
- If you supplied arbitrary values for a field a `create` condition constrains (e.g. an owner id), those requests now return `403` unless the value matches — use `setUserIdField` to have the framework set it.
