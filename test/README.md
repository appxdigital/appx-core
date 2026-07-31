# Test suite

End-to-end tests for `@appxdigital/appx-core`. The harness deliberately does not mock `PrismaService` — the proxy *is* the system under test, so it must run against a real database. Containers are started by [`testcontainers`](https://node.testcontainers.org/).

## Prerequisites

- **Docker daemon** running locally. The first run pulls `mysql:8.0` (~250MB) or `postgres:16-alpine` (~80MB).
- Node.js 20+ (≥20.19 recommended).
- For the optional CLI `create` end-to-end test: a `mysql` (or `psql`) client on PATH so the test can `CREATE DATABASE` on the running container. Skipped automatically when absent.

## Commands

```bash
npm test                # default: DB_PROVIDER=mysql
npm run test:mysql      # explicit
npm run test:postgres   # against Postgres
npm run test:all        # both, sequentially (slowest)
```

Provider is selected at startup via the `DB_PROVIDER` env var.

## Harness architecture

```
┌─────────────────────────── host (jest worker) ──────────────────────────┐
│                                                                          │
│  Spec files:                                                             │
│    test/prisma-proxy.spec.ts                                             │
│         └─ PrismaService directly + appx_proxy DB                        │
│                                                                          │
│    test/http/*.spec.ts                                                   │
│         └─ require(test/fixtures/scaffold-app/dist/app.module.js)        │
│              → @appxdigital/appx-core via file:../../.. symlink          │
│              → fixture's PrismaClient + appx_fixture DB                  │
│                                                                          │
│    test/cli/generate.spec.ts          (synthesized tmpdirs — no DB)      │
│    test/cli/generate-fixture.spec.ts  (asserts the real fixture output)  │
│    test/cli/create.spec.ts            (contract tests + optional        │
│                                        subprocess end-to-end)            │
└──────────────────────────────────────────────────────────────────────────┘
                                       │
                                       │  TCP
                                       ▼
                       ┌─────────────────────────────────┐
                       │  docker:  mysql:8.0  /  pg:16   │
                       │   ├─ appx_proxy                 │
                       │   └─ appx_fixture               │
                       └─────────────────────────────────┘
```

One container, two databases. The proxy spec writes to `appx_proxy`; the HTTP specs (running through the real fixture app) write to `appx_fixture`. Jest runs `maxWorkers: 1` because these share state.

## Layout

```
test/
├── README.md
├── jest.global-setup.ts            # boot DB container, build framework, install fixture, prisma push + generate, build fixture
├── jest.global-teardown.ts         # stops the container
├── setup/
│   └── build-fixture.mjs           # one-time scaffold materialization (run if cli/scaffold/ changes)
├── mocks/
│   ├── adminjs.cjs                 # CJS stub for ESM-only adminjs
│   └── adminjs-prisma-property.cjs
├── fixtures/
│   ├── prisma/schema.prisma.template     # proxy harness schema (rendered per run)
│   ├── permissions.ts                    # PermissionsConfig fixture for proxy ABAC tests
│   ├── .runtime/                         # gitignored — rendered schema + generated client per run
│   └── scaffold-app/                     # ⭐ real consumer project (committed)
│       ├── src/
│       │   ├── main.ts, app.module.ts, app.controller.ts, app.service.ts
│       │   ├── config/{permissions,admin}.config.ts
│       │   └── prisma/prisma.module.ts
│       ├── prisma/schema.prisma
│       ├── package.json                  # @appxdigital/appx-core → file:../../..
│       ├── tsconfig.json, tsconfig.build.json
│       └── .gitignore, .env.example      # .env, node_modules, dist, src/generated, src/modules — all gitignored
├── helpers/
│   ├── test-db.ts                  # container lifecycle (creates both DBs); schema templating
│   ├── test-module.ts              # Nest TestingModule + asUser(req-context wrapper) — proxy harness
│   ├── fixture-app.ts              # buildFramework, ensureFixtureInstalled, writeFixtureEnv, push + generate + build
│   └── fixture-bootstrap.ts        # bootFixture(): boot the fixture's AppModule in-process for supertest
├── prisma-proxy.spec.ts            # ABAC engine tests — 14 cases
├── http/                           # HTTP-level regression tests against the booted fixture
│   ├── register-validation.spec.ts
│   ├── generated-crud-validation.spec.ts
│   ├── session-admin-authz.spec.ts
│   ├── cors.spec.ts
│   └── create-conditions.spec.ts
└── cli/
    ├── generate-fixture.spec.ts    # real-fixture: prisma generate → generate (safe) → generate models --all → tsc
    ├── create.spec.ts              # scaffold-template contract + optional subprocess
    └── create-parity.spec.ts       # end-to-end: spawn `cli.js create`, diff vs committed fixture
```

## What's covered

### `prisma-proxy.spec.ts` — 14 tests (proxy harness, appx_proxy DB)

Blacklisted methods, USER_ID placeholder filtering, ADMIN unrestricted reads, GUEST default-deny, `@Role(ADMIN)` field omission, `BYPASS_FILTERING` / `BYPASS_OMISSION` escape hatches, `withExposedModels`, `count` fallback to read permissions, create-condition enforcement (a USER cannot attribute a record to another user).

### `http/*.spec.ts` (real fixture, appx_fixture DB)

- **Register validation**: the hardened ValidationPipe rejects unknown body fields (e.g. `role`) with `400`.
- **Generated-CRUD validation**: `POST /type-samples` rejects unknown / non-writable fields (`id`, `secret` @Role(none), `internalNote` @NoWrite) via the per-model DTO, and accepts a valid create (DateTime coerced from an ISO string).
- **Session-admin endpoints**: `/auth/sessions/:userId` is guarded (authenticated + ADMIN).
- **CORS**: origin is configurable; other origins are blocked.
- **Create conditions + default-deny**: a USER can only create a `ProjectMember` in a project they own; creating a model with no create permission is denied.

### `cli/generate-fixture.spec.ts` — 9 tests (real-fixture, canonical)

(The synthesized-tmpdir variant was retired on 2026-05-21 in favour of single-source-of-truth tests against the live fixture. Real-fixture exercises the same invariants end-to-end.)

| Check | |
|---|---|
| Per-model emission (`module.ts`, `controller.ts`, `service.ts`, `resolver.ts`) | smoke |
| Kebab → PascalCase | `project-member` → `ProjectMember` |
| Controller route is lowercase pluralised | `@Controller('users')` |
| Per-model DTOs are generated; controller types its body with them | request validation surface |
| `prisma.model.<lowerFirst>` access in service | `ProjectMember` → `prisma.model.projectMember` |
| Generated module declares Controller + Service + Resolver providers | wiring |
| `app.module.ts` updated with new imports | regex append safety |
| Generated TypeScript typechecks (`tsc` ran in globalSetup) | post-generation type-correctness |
| `src/modules/` contains only directories | generator-hygiene regression |

### `cli/generate-fixture.spec.ts` — 9 tests (real fixture, end-to-end)

Asserts that after globalSetup runs `prisma generate` → `prisma-nestjs-graphql` → `appx-core generate` → `tsc`, the fixture's `src/modules/user/` has the canonical files, `app.module.ts` is patched with `UserModule`, per-model DTOs are emitted and the controller types its body with them, `src/generated/user/` has graphql types, and `dist/` typechecks. Also asserts `src/modules/` contains only directories (generator hygiene).

### `cli/create.spec.ts` — 8 tests (contract + optional end-to-end)

- Scaffold-template contract: every `{{KEY}}` placeholder is documented, secrets use `crypto.randomBytes`, scaffold permissions don't grant USER role create/update/delete, scaffold `main.ts` applies baseline hardening via `setupCoreSecurity`, `.env.template` has no hardcoded secrets.
- Project-name path-traversal pinning.
- Subprocess end-to-end (slow; skipped if `mysql` client not on PATH): spawns the real `node cli/cli.js create` against a one-off DB on the running container, drives prompts via stdin, asserts project skeleton + random secrets in `.env`.

## Adding tests

For new proxy/ABAC behaviour:
1. Add the rule to `test/fixtures/permissions.ts` if needed.
2. Use `asUser({ id, role }, () => prisma.model.x...)` to run code with a synthetic request context.
3. Use the `rawClient` from `buildTestModule` for setup/teardown — it bypasses the proxy.

For new HTTP-level security tests:
1. Boot the fixture via `bootFixture(...)`. Pass `validationPipe: 'scaffold-default'` to reproduce as-shipped behaviour; pass `{whitelist:true, ...}` to test a hardened variant.
2. Use `booted.withFreshDb((c) => c.user.findFirst(...))` for read-after-write assertions — long-lived clients have snapshot issues.
3. For login-required flows, register an admin via `POST /auth/register`, then `POST /auth/login/jwt` and use the `access_token` as a Bearer.

For new CLI generator behaviour:
- Fast/unit: add a case to `cli/generate.spec.ts` via `makeFixtureProject([...])` + `runGenerator(...)`.
- End-to-end: add an assertion to `cli/generate-fixture.spec.ts` against the real fixture output.

## Cross-DB testing

Both MySQL and Postgres run the same suite via `DB_PROVIDER`. Each provider gets its own rendered schema (proxy harness) + own appx_proxy / appx_fixture databases.

If a behaviour diverges by provider (e.g., enum support, `String @db.Text`), add a `provider` check inside the test rather than maintaining two specs.

## Performance notes

- First run: ~60s for image pull + container boot + fixture `npm install`. Subsequent runs ~10s (lockfile-hash cached).
- All specs share one container (jest globalSetup). Don't spawn additional containers from within tests.
- Tests reset DB state via `resetDb(rawClient)` / `resetFixtureDb` in `beforeEach`. Cheaper than restarting the container.
- `maxWorkers: 1` is intentional — specs share the DB pair and cannot run in parallel.
- If you change `cli/scaffold/` templates, re-run `node test/setup/build-fixture.mjs` and commit the diff in `test/fixtures/scaffold-app/`.
