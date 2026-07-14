# AGENTS.md — AppX Core

This file orients AI coding agents (Claude, Cursor, Aider, Copilot Workspaces, etc.) working inside `@appxdigital/appx-core`. The user-facing documentation lives in `README.md`; this file is the operational map.

> Audience: code agents. Tone: direct. If something here disagrees with the code, **trust the code** and update this file.

---

## 1. What this package is, in one paragraph

`@appxdigital/appx-core` is a NestJS-on-Prisma framework that bakes **attribute-based access control (ABAC)** into the data layer via a Prisma client proxy, ships an **AdminJS backoffice**, and exposes a CLI (`@appxdigital/appx-core-cli`) that **scaffolds** a NestJS project and **generates** CRUD modules from a Prisma schema. The selling proposition is that downstream apps stop hand-rolling auth/permissions/admin plumbing and instead declare row-level and field-level rules in a single `permissions.config.ts`, which is then enforced automatically on every Prisma call.

---

## 2. Repository layout

```
appx-core-package/
├── src/                              # The published framework (compiled to dist/)
│   ├── index.ts                      # Public package surface — only export from here
│   ├── appx-core.module.ts           # AppxCoreModule.forRoot(permissionsConfig, fileUploadConfig)
│   ├── prisma/
│   │   └── prisma.service.ts         # ⭐ THE proxy. ABAC engine lives here.
│   ├── modules/
│   │   ├── core/                     # CoreController / CoreService — generated CRUD extends these
│   │   ├── auth/                     # Cookie + JWT auth, session store, strategies
│   │   ├── user/                     # Default User model wiring
│   │   ├── file/                     # File upload module (S3 / GCS / local)
│   │   └── common.module.ts          # Re-exports RbacGuard + UserPopulationGuard
│   ├── backoffice/
│   │   └── appx-core-admin.module.ts # AdminJS @ /admin (dynamic ESM imports)
│   ├── graphql/
│   │   ├── graphql.module.ts         # Apollo driver
│   │   └── generic.resolver.ts       # Read queries only — mutations are commented out
│   ├── config/
│   │   ├── generate-all.ts           # `appx-core generate` orchestrator
│   │   ├── generate-modules.ts
│   │   ├── generate-controllers.ts
│   │   ├── generate-services.ts
│   │   ├── generate-resolvers.ts
│   │   └── setup-fileupload.ts
│   ├── common/
│   │   ├── decorators/               # @Permission, @GuardMethod, @UseTransaction, @AuthField
│   │   ├── guards/                   # RbacGuard, RolesGuard, UserPopulationGuard
│   │   ├── interceptors/             # PrismaInterceptor (sets CorePrismaContext + tx)
│   │   ├── config/                   # PermissionsConfigType, PermissionPlaceholder, etc.
│   │   ├── providers/                # AWS / GCP / local storage backends
│   │   ├── enums/role.enum.ts        # DefaultRole (not currently enforced as a type)
│   │   └── utils/                    # context-transformer, error-handler
│   └── tasks/session-cleanup.service.ts
├── cli/
│   ├── cli.js                        # Commander entry: `create`, `generate`, `setup:fileupload`
│   ├── scaffold/                     # Template tree copied by `create`
│   │   ├── .env.template             # {{KEY}} placeholders, replaced via regex
│   │   ├── prisma/schema.prisma.template
│   │   └── src/                      # main.ts, app.module.ts, config/, prisma/, backoffice/
│   └── utils/fileUploadConfig.js     # Interactive prompts for `setup:fileupload`
├── dist/                             # Build output (gitignored — npm pack ships this)
└── README.md                         # User-facing docs
```

---

## 3. Core mental model

### 3.1 The Prisma proxy (`src/prisma/prisma.service.ts`)

`PrismaService` wraps the Prisma client in **two nested Proxies**:

1. The outer proxy intercepts model access (`prisma.user`, `prisma.post`, …).
2. The inner proxy intercepts method calls (`findMany`, `create`, `updateMany`, …).

On every model method call, the proxy does, in order:

| Step | Code | What it does |
|---|---|---|
| 1. **Blacklist** | `prisma.service.ts:86-95` | Throws if you call `findUnique`, `findUniqueOrThrow`, `delete`, or `update`. Use `findFirst` / `deleteMany` / `updateMany` instead — they accept arbitrary `where` so the proxy can inject permission filters. |
| 2. **Field omission** | `prisma.service.ts:231-266` (skipped for `create*`/`update*`/`delete*`) | Reads `@Role(...)` annotations from Prisma schema field doc-comments. Removes from `select` (or rewrites `include` → `select`) any field the current role isn't allowed to read. |
| 3. **Where filtering** | `prisma.service.ts:288-460` (skipped for `create`/`createMany`) | Looks up `permissionsConfig[modelLowercase][role][action]`. If `'ALL'` → no-op. If `{conditions: {...}}` → ANDs the conditions into the existing `where`. Recurses for nested relations. |
| 4. **Substitute placeholders** | `prisma.service.ts:494-519` | Replaces `PermissionPlaceholder.USER_ID` (`'$USER_ID'`) with the current user's id from `RequestContext`. |
| 5. **Run on tx client if present** | `prisma.service.ts:82` | If `PrismaInterceptor` wrapped the request in a `$transaction`, the call routes through `RequestContext.currentContext.req.prisma` instead of the bare client. |

> **`create` / `createMany` don't inject a `where` (step 3) — there's no existing row to filter.** Instead the proxy validates the incoming data against the create permission's `conditions` before insert (own-scalar fields against the data; relation conditions by looking up the referenced parent), and default-denies create when the model/role has no `create` permission. Framework flows that must create without a permission (registration, sessions, tokens) pass `BYPASS_FILTERING`.

### 3.2 The `@Permission` decorator and `RbacGuard`

```ts
@Permission('findMany')              // requires permissionsConfig[entity][role].findMany
@Permission('checkEmail', ['user'])  // also temporarily exposes the User model (skips filtering)
```

- `RbacGuard` (`src/common/guards/rbac.guard.ts`) reads the metadata, looks up `permissionsConfig[entity][role][action]`, and **throws if missing**. It does **not** evaluate `conditions` itself — that's the proxy's job.
- The controller class must expose `static get entityName()` (set by generated CRUD; required for the guard).
- The second decorator argument (`expose_models`) is forwarded by `PrismaInterceptor` into `CorePrismaContext` so the proxy treats those models as `'ALL'` for the duration of the request.

### 3.3 Request context

Two stacks of context propagate per-request via `AsyncLocalStorage`:

- `RequestContext.currentContext.req` (from `nestjs-request-context`) — holds `req.user`, `req.prisma` (active transaction client), `req.corePrismaDebug`.
- `CorePrismaContext` (defined in `prisma.service.ts:10`) — holds `exposedModels: string[]` for `withExposedModels`.

If `RequestContext.currentContext` is `null` (e.g., outside HTTP, in a cron task, in a script), the proxy falls back to `userRole = 'GUEST'` and uses the bare Prisma client. **Code that runs outside a request must wrap calls in `withExposedModels` or accept `BYPASS_*` options.**

### 3.4 Bypass options

Every proxied method accepts a second arg:

```ts
await this.prisma.user.findFirst(
    { where: { email } },
    { BYPASS_FILTERING: true, BYPASS_OMISSION: true },
);
```

Used by `AuthService`, `SessionSerializer`, `CorePrismaSessionStore`, and AdminJS. **These bypasses are a footgun** — they are how authentication itself works (you can't look up the user *before* you know who the user is) but they also disable all ABAC. Use them sparingly and never in user-facing service code.

### 3.5 Action fallback chain

`selectPermission` (in `prisma.service.ts`) implements aliases so configs stay compact:
- `count` falls back to `findMany` then `findFirst`
- `findFirst` / `findUnique`-shape reads fall back to `findMany`

This is convenient but means a single `findMany: 'ALL'` entry implicitly grants `count` and `findFirst`.

---

## 4. Auth surface (generated apps)

Routes mounted under `/auth` (see `src/modules/auth/auth.controller.ts`):

| Route | Guard | Notes |
|---|---|---|
| `POST /auth/register` | **none** | Public. Body constrained by `RegisterDto` (email + password); forwards to `userService.createUser`. |
| `POST /auth/login` | `LocalAuthGuard` | Cookie/session login. |
| `POST /auth/logout` | `AuthenticatedGuard` | |
| `GET /auth/me` | `AuthenticatedGuard` | |
| `GET /auth/sessions` | `AuthenticatedGuard` | Current user's sessions. |
| `POST /auth/sessions/close-my-sessions` | `AuthenticatedGuard` | |
| `GET /auth/sessions/:userId` | `AuthenticatedGuard` + inline `role !== 'ADMIN'` check | Role check is not yet part of the permissions config. |
| `POST /auth/sessions/:sessionId/close` | `AuthenticatedGuard` + inline `role !== 'ADMIN'` check | Same. |
| `POST /auth/login/jwt` | `LocalAuthGuard` | Returns `{accessToken, refreshToken}`. |
| `POST /auth/refresh` | `RefreshTokenGuard` | Token in request **body** (`refreshToken`). |
| `POST /auth/logout/jwt` | `LocalAuthGuard` | Revokes all refresh tokens for the user. |

Password hashing: **argon2**. Refresh tokens are stored in `UserRefreshToken` and rotated on use (`auth.service.ts:235-261`).

---

## 5. CLI (`cli/`)

Three commands exposed by `cli/cli.js`:

| Command | What it does |
|---|---|
| `appx-core create` | Interactive prompt → copies `cli/scaffold/` to target dir, replaces `{{KEY}}` placeholders, runs `npm install`. Generates `JWT_SECRET` / `SESSION_SECRET` via `crypto.randomBytes(32).toString('hex')` (not the README's `"change-me"` literal — those are illustrative). |
| `appx-core generate` | Delegates to `dist/config/generate-all.js`. Pipeline: `prisma generate` → `generate-modules.ts` → `generate-resolvers.ts` → `generate-services.ts` → `generate-dtos.ts` → `generate-controllers.ts`. Driven by `src/generated/` (output of `prisma-nestjs-graphql`) + the Prisma DMMF (for DTO field metadata). |
| `appx-core setup:fileupload` | Interactive prompts in `cli/utils/fileUploadConfig.js`. Appends to `.env`, writes `src/config/file-upload.config.ts`. |

### `generate` details

- **Templates are plain JS template literals.** No EJS/Handlebars. See `src/config/generate-controllers.ts:13-29`.
- **Each generated file uses `createFileIfNotExists`** (`src/config/utils.ts:10-18`). Re-running `generate` is safe for already-generated modules — your edits are kept. But it **does** edit `src/app.module.ts` via regex append (`generate-modules.ts:43`); if the regex misses, you may get duplicated imports.
- **`src/generated/` is the source of truth** for what models exist. It's emitted by `prisma-nestjs-graphql` from your `schema.prisma`.
- **Generated controllers and services are thin wrappers** around `CoreController<T>` / `CoreService<T>`. All actual CRUD logic lives in `src/modules/core/`.
- **DTOs are generated per model+action** (`generate-dtos.ts`, since 0.1.124). Two files:
  - `src/generated/dto/<model>/<action>-<model>.generated.dto.ts` — base, **always overwritten**, gitignored (under `src/generated/`), carries the `@Generated` banner. Never hand-edit. Uses `writeGeneratedFile` (overwrite), not `createFileIfNotExists`.
  - `src/modules/<model>/dto/<action>-<model>.dto.ts` — hand-owned subclass, generated **once** (`createFileIfNotExists`), committed. Add custom validation here.
  The generated controller **overrides** `create`/`update` with the concrete DTO type so `ValidationPipe` (`whitelist`) can strip unknown fields. **Schema is the source of truth** for the writable field set.
- **Writable-field policy** (what appears in a DTO): all scalars except `@id`, server-managed timestamps (`@default(now())` / `@updatedAt`), `/// @NoWrite`, and `/// @Role(none)`. Relation navigation fields are excluded; their scalar FKs are kept. To make a field non-writable via CRUD, annotate it `/// @NoWrite` (all roles) or use `restrictedFields` on the permission (per role).
- **`dto` is in `IGNORE_FOLDERS`** — the model generators scan `src/generated`'s top-level dirs as model names, so the `src/generated/dto/` dir must be skipped or they emit a bogus `dto` module.

---

## 6. Building, running, testing

| Task | Command |
|---|---|
| Build | `npm run build` (just `tsc`) |
| Publish (manual) | `npm run npm:publish` (rimraf → build → `npm publish --access=public`) |
| Pull schema from a running DB | `npm run db-pull` |
| Run tests | `npm test` (see `test/README.md` once the suite is in place) |

The package itself **has no runtime** — it's a library + a CLI. To test changes, scaffold a consumer app via the CLI (or use `test/fixtures/`) and `npm link` this package in.

### Supported / tested database providers

| Provider | Status | Notes |
|---|---|---|
| MySQL | ✅ Validated | Primary target. README's `DB_PROVIDER=mysql` default. |
| PostgreSQL | ✅ Validated | Supported via Prisma's standard driver. |
| SQLite | ❌ Not validated | Avoid — `String @db.Text` and `@db.VarChar(255)` in the scaffold schema are MySQL-flavored; `Session.data` and refresh-token columns will need rewriting. |
| SQL Server | ❌ Not validated | Prisma supports it, but the framework has not been exercised against it. |
| MongoDB | ❌ Not supported | Several features (`@@index`, raw SQL session store assumptions, refresh-token unique constraints) are relational-only. |

The test suite under `test/` exercises both MySQL and PostgreSQL via `testcontainers`. **Do not mock `PrismaService`** — the proxy is the system under test. Tests must boot a real database container.

---

## 7. Known limitations

These are intentional or known-broken and should be respected when changing code:

1. **Prisma single-record methods are blocked.** `findUnique`, `findUniqueOrThrow`, `delete`, `update` all throw at runtime. Use `findFirst`, `findFirstOrThrow`, `deleteMany`, `updateMany` with a restrictive `where`. *(Reason: the proxy needs a `where` to inject filters.)*
2. **`create` / `createMany` validate conditions before insert** (there is no existing row for a `where`). The proxy checks the incoming data satisfies the create permission's `conditions` and default-denies create when the model/role has no `create` permission. Unsupported condition shapes (list-relation `some`/`every`/`none`, exotic operators) fail **closed** — for those, use `setUserIdField` + `restrictedFields` and validate input in DTOs.
3. **GraphQL mutations are commented out** (`src/graphql/generic.resolver.ts:105-228`). Only `findAll` / `findOne` / `findFirst` / `aggregate` queries are wired. README acknowledges "not fully ready".
4. **`RbacGuard` only checks existence**, not conditions. The proxy enforces conditions on reads/updates/deletes. There is **no defence-in-depth at the controller layer** — if you bypass the proxy (e.g., raw SQL, direct client access), you bypass ABAC entirely.
5. **Permission config is keyed by role string, with no type safety.** `DefaultRole` enum exists but isn't enforced; configs use bare strings like `'ADMIN'` / `'USER'` / `'GUEST'`. Typos in a role string silently fall through to "no permissions defined" → 403.
6. **AdminJS uses its own auth path** (`appx-core-admin.module.ts:141-176`) and globally exposes the `User` model during login via `withExposedModels(['User'])`. It does **not** reuse main auth sessions.
7. **Session cookies** are built via `buildCoreSessionOptions` in the scaffold's `main.ts` (`httpOnly`, `secure` in production, `sameSite`, `maxAge` from TTL). A session secret is required — the helper throws if it is missing or `< 32` chars.
8. **CORS** is read from `CORS_ORIGIN` (via `setupCoreSecurity`) in the scaffold; set it to your real origin in production. `origin: '*'` combined with `credentials: true` throws at boot.
9. **The global `ValidationPipe` whitelist** is applied by `setupCoreSecurity` (`{ transform, whitelist, forbidNonWhitelisted }`). Combined with the generated per-model DTOs, unknown body fields are rejected (`400`). Keep DTO classes declaring every accepted field with class-validator decorators.
10. **No audit logging** of permission denials. Diagnostic logging is opt-in via `prismaService.debugQueries(true)` per-request.
11. **Default permissions config in the scaffold** (`cli/scaffold/src/config/permissions.config.ts`) gives `ADMIN` `create: 'ALL'` and `updateMany: 'ALL'` on the User model with **no `restrictedFields`**. An ADMIN-callable endpoint with that config will accept arbitrary fields, including `role`. Customize per-model before going live.

---

## 8. Rules for agents working in this repo

### 8.0 Change policy (production framework — read first)

This package is **in production, consumed by many projects**. Every change ships to real deployments, so the bar is:

1. **Change only what is absolutely necessary.** If a finding can be addressed without touching adjacent code, don't touch adjacent code. No opportunistic refactors, renames, or style cleanups riding along with a fix — big refactors introduce fragilities that are worse than the issue being fixed.
2. **Surgical fixes.** Prefer the smallest diff that closes the issue. If the minimal fix and the "right" long-term design differ, do the minimal fix and record the long-term option in `ROADMAP.md`.
3. **Tests come first.** Before changing behaviour, a test must pin the current behaviour and flip when the fix lands. This is why the test suite (ROADMAP §1–§4) precedes remediation work.
4. **Atomic commits, committed separately.** One logical change per commit, with a short message. Never bundle an unrelated fix, a test, and a refactor into one commit.
5. **A human reviews and tests every change** in a production project locally before the package is deployed. Write changes to be reviewable: small, self-explanatory diffs whose intent is obvious from the commit message.

### 8.1 Versioning & migration notes (`CHANGELOG.md`)

Consuming projects upgrade this package by bumping the npm version — they do **not** re-scaffold. So any fix that lives in `cli/scaffold/` (a file the project now owns its own copy of) or that changes runtime behaviour must tell existing projects what to do.

- **Every behaviour or API change bumps `version` in `package.json`** and gets a `CHANGELOG.md` section. Patch bump for fixes; minor for additive API; major for breaking changes.
- **If an existing project must do anything to get the fix or to stay working, write a `### Migration` block** under that version. Make it copy-paste ready and small enough to hand to an AI coding agent — that is the intended way consumers apply them. If no action is needed, say the upgrade is drop-in (no Migration block).
- **Scaffold-only fixes reach new projects automatically but not existing ones.** Call this out and give the by-hand steps in the Migration block.
- `CHANGELOG.md` tracks *what shipped and what to do* — add an entry (with a `### Migration` block when consumers must act) whenever you change runtime or scaffold behaviour.

**DO**
- Treat `src/prisma/prisma.service.ts` as load-bearing. Read it before you change anything in `src/modules/core/` or the proxy.
- When adding endpoints, use `@Permission('actionName')` and add an entry to `permissions.config.ts` for every role × action pair you want to allow. Default-deny is the existing behaviour: an undefined `[model][role]` throws 403.
- Use `findFirst` / `deleteMany` / `updateMany` everywhere. If you find a `findUnique` or bare `update`/`delete` in `src/` or in generated code, that's a bug — file or fix it.
- When you must skip ABAC (auth flows, session store, scheduled tasks), pass `{ BYPASS_FILTERING: true }` or `{ BYPASS_OMISSION: true }` explicitly. Don't introduce new global escape hatches.
- Update `AGENTS.md` when you change permission, proxy, or auth behaviour.
- **Configure a scaffolded app's boot via the setup helpers**, not inline: `setupCoreSecurity(app, …)` (hardened ValidationPipe + CORS + Helmet), `buildCoreSessionOptions(…)` (throws on a missing/weak `SESSION_SECRET`, sets secure cookie flags), `coreEnvFilePath()` (throws if `NODE_ENV` unset). These fail fast on insecure config by design — don't reintroduce an inline `ValidationPipe`, a `secret ?? '…'` fallback, or a `NODE_ENV || 'development'` default.
- **Write to `ROADMAP.md` when you finish a turn knowing about work you didn't do.** Anything in the "I did not do …" category at end-of-turn belongs in `ROADMAP.md`'s "Suggestions / loose ends" section (with the date and the section/issue that prompted it). Anything that needs a human decision before being implemented goes in "Open questions for the team". Don't leave these as implicit-knowledge — future sessions won't know.

**DON'T**
- Don't mock `PrismaService` in tests. The proxy *is* the behaviour. Use the testcontainers harness under `test/`.
- Don't add features to `RbacGuard` that duplicate the proxy. The guard's job is to refuse unknown action/role pairs early; data filtering stays at the data layer.
- `create` permission `conditions` are validated against the incoming data before insert (own-scalar fields and belongsTo relations). For per-role field restrictions use `restrictedFields`; to set an owner id server-side use `setUserIdField`. Validate inputs in DTOs.
- Don't read secrets from `process.env` directly in framework code; use `ConfigService`.
- Don't write to paths under `src/generated/` by hand; that directory is owned by `prisma generate` / `prisma-nestjs-graphql`.
- Don't change the public API surface in `src/index.ts` without bumping the version in `package.json` and noting it in commit history.

---

## 9. Where to look next

- `README.md` — user-facing setup, permission examples
- `test/README.md` — test harness, container setup, fixture conventions
- `cli/scaffold/src/config/permissions.config.ts` — the smallest real example of a permissions config
- `src/prisma/prisma.service.ts` — read it. There's no substitute.
