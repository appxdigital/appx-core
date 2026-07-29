# AppX Core

<p align="center">
  <img src="./public/appx-core-logo.png" alt="AppX Core Logo" width="220" />
</p>

[![CI](https://github.com/appxdigital/appx-core/actions/workflows/ci.yml/badge.svg)](https://github.com/appxdigital/appx-core/actions/workflows/ci.yml)
[![Release](https://github.com/appxdigital/appx-core/actions/workflows/release.yml/badge.svg)](https://github.com/appxdigital/appx-core/actions/workflows/release.yml)
[![Release CLI](https://github.com/appxdigital/appx-core/actions/workflows/release-cli.yml/badge.svg)](https://github.com/appxdigital/appx-core/actions/workflows/release-cli.yml)

**AppX Core** is a production-oriented backend foundation that accelerates the delivery of secure, data-access-controlled APIs with an integrated admin backoffice. It scaffolds a native **NestJS** application and extends it with opinionated building blocks for authentication, authorization (ABAC-first), CRUD acceleration, and administration through **AdminJS**.

Built and maintained by **AppX** (appx-digital.com).

---

## Table of Contents

- [Why AppX Core](#why-appx-core)
- [Key Features](#key-features)
- [Architecture Overview](#architecture-overview)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [1) Install the CLI](#1-install-the-cli)
  - [2) Create a New Project](#2-create-a-new-project)
  - [3) Configure Environment](#3-configure-environment)
  - [4) Define Data Models](#4-define-data-models)
  - [5) Generate Modules and CRUD](#5-generate-modules-and-crud)
  - [6) Run Migrations](#6-run-migrations)
  - [7) Run the App](#7-run-the-app)
  - [What you get out of the box](#what-you-get-out-of-the-box)
- [Core Concepts](#core-concepts)
  - [Project Structure](#project-structure)
  - [Admin Backoffice](#admin-backoffice)
  - [Authentication](#authentication)
  - [Authorization Model](#authorization-model)
- [Permissions](#permissions)
  - [Permissions Configuration Shape](#permissions-configuration-shape)
  - [Rules](#rules)
  - [Reading Related Models](#reading-related-models)
  - [Action Aliases and Fallbacks](#action-aliases-and-fallbacks)
  - [Custom Controller Actions](#custom-controller-actions)
  - [Temporarily Exposing Models](#temporarily-exposing-models)
- [Generated CRUD Endpoints](#generated-crud-endpoints)
- [Examples](#examples)
  - [Example 1: Admin-Only Operational Endpoint](#example-1-admin-only-operational-endpoint)
  - [Example 2: “My Profile” Endpoint (User Can Only See Self)](#example-2-my-profile-endpoint-user-can-only-see-self)
  - [Example 3: Registration Email Availability Check](#example-3-registration-email-availability-check)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Support](#support)
- [Security](#security)
- [Contributing](#contributing)
- [License](#license)

---

## Why AppX Core

Modern applications often fail not because teams cannot build endpoints, but because they ship access control too late, build inconsistent admin tooling, and recreate the same authentication and backoffice plumbing across projects.

AppX Core puts **security and data-access control first**, while keeping development fast:

- Start from a **native NestJS** structure (no “framework lock-in”).
- Define data in **Prisma** once.
- Generate a robust baseline for CRUD and service structure.
- Enforce permissions where it matters: **at the data layer** (ABAC).
- Operate and administrate through a standard **AdminJS** backoffice.

---

## Key Features

- **NestJS-native scaffold** (standard structure, editable modules)
- **Prisma ORM integration** with opinionated permissions enforcement
- **ABAC-first permission filtering** (attribute-based access control)
- **AdminJS backoffice** exposed at `/admin` with configurable access and models
- **Authentication out-of-the-box**
  - Cookie/session auth
  - JWT auth (recommended)
- **Fast CRUD acceleration**
  - Generated modules, controllers, and services per model
  - Standard REST CRUD endpoints
- **Developer-friendly extension points**
  - Add custom endpoints with `@Permission(...)`
  - Use services for business logic, controllers as transport layer

---

## Architecture Overview

AppX Core is designed as a **base layer** on top of NestJS:

- Your application remains a NestJS project with conventional modules.
- AppX Core provides:
  - base configuration and wiring
  - authentication modules
  - permissions system (ABAC)
  - generation pipeline based on Prisma schema
  - AdminJS integration

---

## Getting Started

### Prerequisites

- **Node.js 20+**
- A running database (**MySQL** or **PostgreSQL** tested/validated)

### 1) Install the CLI

```bash
npm install -g @appxdigital/appx-core-cli
```

**Release channels.** AppX Core publishes both packages on two npm dist-tags:

- **`latest`** — stable releases. This is what the commands above install.
- **`beta`** — prereleases, for trying upcoming changes before they're promoted. Opt in explicitly with the `@beta` tag (a caret range such as `^0.1.x` never resolves to a prerelease on its own):

```bash
npm install -g @appxdigital/appx-core-cli@beta   # CLI prerelease
```

`appx-core create` pins the library to **the CLI's own channel** — a stable CLI scaffolds a project depending on the stable library, a beta CLI (`@beta`) one depending on the beta library. To move an existing project across channels, install it there directly:

```bash
npm install @appxdigital/appx-core@beta          # inside your project
```

**Staying up to date (automatic).** The CLI keeps itself current. On each run it checks the registry in the background (throttled), and when a newer version is published **on your channel** it installs it before your *next* command and re-launches into the new binary — so a beta install stays on `beta`, a stable install stays on `latest`. The check never blocks your command, and a failed/offline check is silently ignored.

```bash
appx-core update                 # update now, on your current channel
appx-core update --channel beta  # switch to the beta channel (or --channel production to switch back)
APPX_CORE_NO_AUTO_UPDATE=1 …     # disable the background auto-update entirely
```

Install logs (only written when an update runs) go to `~/.appx-core/last-install.log`.

### 2) Create a New Project

```bash
appx-core create
cd <your-project>
```

**Non-interactive (CI / scripts).** Passing `--yes` — or any value flag — skips the wizard entirely; anything not given uses the wizard's default. No prompt is ever opened, so it's safe without a TTY. The database check still runs and fails fast with the reason instead of re-prompting.

```bash
appx-core create --yes \
  --name my-app \
  --db-provider mysql --db-host 127.0.0.1 --db-port 3306 \
  --db-user root --db-password secret --db-name my_app_db
```

Flags: `--name`, `--db-provider mysql|postgresql`, `--db-host`, `--db-port`, `--db-user`, `--db-password`, `--db-name`, `--show-output`. File upload isn't configured on this path — run `appx-core setup:fileupload` inside the project afterwards.

### 3) Configure Environment

`appx-core create` **already writes a `.env`** at the project root, with secure
random secrets generated for you. You don't need to create it by hand — just
open it and set your database connection (and `CORS_ORIGIN` for production). The
generated file looks like this:

```bash
## Database ##
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=generic
DB_PROVIDER=mysql
DB_URL="${DB_PROVIDER}://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

## App ##
APP_PORT=3000
USE_TRANSACTION=true
CORS_ORIGIN=http://localhost:3000   # your front-end origin; set to your real domain in production

## Sessions ##
SESSION_SECRET=<64-char random hex — generated for you>
SESSION_COOKIE_NAME=session_nestjs-project
SESSION_TTL=86400

## JWT ##
JWT_EXPIRES_IN=10d
JWT_REFRESH_EXPIRES_IN=1y
JWT_SECRET=<random — generated for you>
JWT_REFRESH_SECRET=<random — generated for you>
```

> **Keep the generated secrets — don't replace them with placeholders like `change-me`.**
> `SESSION_SECRET` must be **at least 32 characters** or the app throws at
> startup (`buildCoreSessionOptions` — there is no insecure fallback).
>
> **`NODE_ENV`** must be set in the runtime environment. The `start` scripts set
> it to `development`; set it explicitly in production. Env files resolve as
> `.env.${NODE_ENV}` first, then `.env` (via `coreEnvFilePath()`), so a plain
> `.env` works for development and you can add `.env.production` for prod.

Baseline HTTP hardening (a whitelisting `ValidationPipe`, CORS, and Helmet) is
applied for you by `setupCoreSecurity(app, …)` in `src/main.ts`; `helmet` is a
peer dependency the scaffold already includes.

### 4) Define Data Models

Edit:

- `prisma/schema.prisma`

Add your application models. You can add fields and relations freely. Avoid removing or changing types of the default models shipped with AppX Core.

If you already have an existing database schema and want to import it:

```bash
npx prisma db pull
```

**Important:** `db pull` overrides `schema.prisma`. Ensure you preserve default AppX Core models/configuration and merge accordingly.

### 5) Generate Modules and CRUD

There are two generation commands, split by what they touch:

```bash
# Deploy-safe: regenerate the Prisma client, GraphQL types and DTO base classes
# under src/generated/ (gitignored). Never writes src/modules/ or app.module.ts,
# so it is safe in CI / postinstall / predeploy. Run it every time the schema
# changes (no need to run `prisma generate` separately).
appx-core generate

# Scaffold CRUD for the tables you want to EXPOSE. Interactive picker listing
# models that don't yet have a module; for each selected model it creates the
# module/service/controller/resolver + DTO subclass and registers the module in
# app.module.ts, then runs the safe pass above.
appx-core generate models
#   appx-core generate models Habit Log   # non-interactive: named models
#   appx-core generate models --all       # every generatable model
```

Not every table needs its own module — because CRUD supports permission-gated
nested writes (`create` / `connect`), you can expose a parent and write related
rows through it. Scaffold modules only for the resources you actually serve.

> **`generate` is deploy-safe; `generate models` mutates code.** Only `generate
> models` writes hand-owned files and edits `app.module.ts` — run it during
> development. `generate` alone is idempotent and touches only `src/generated/`.
> The `User` model is framework-owned (auth already serves user endpoints) and is
> never offered by the wizard.

Full reference: **[docs/generate.md](./docs/generate.md)**.

### 6) Run Migrations

```bash
npx prisma migrate dev
```

You will be asked for a migration name.

### 7) Run the App

```bash
npm run start:dev
```

### What you get out of the box

- Admin backoffice at **`/admin`** (after you include models in `src/config/admin.config.ts`)
- Auth endpoints with no prefix:
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/logout`
  - `GET /me`
  - `POST /login/jwt` (recommended)
  - `POST /logout/jwt`

---

## Core Concepts

### Project Structure

AppX Core generates a standard NestJS structure. You will typically see:

- `src/main.ts` – app bootstrap and cross-cutting config (cookies, sessions, logs, CORS)
- `src/app.module.ts` – high-level module wiring

Most customization happens in:

- `src/config/permissions.config.ts` – granular ABAC rules
- `src/config/admin.config.ts` – AdminJS configuration and model registration
- `prisma/schema.prisma` – your data model source of truth

### Admin Backoffice

- AdminJS is exposed at **`/admin`**
- Models must be included/configured in `admin.config.ts` to appear in the UI.

### Authentication

Cookie/session:

- `POST /auth/register`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`

JWT (recommended):

- `POST /login/jwt`
- `POST /logout/jwt`

### Authorization Model

AppX Core emphasizes enforcement at the data layer:

- Permissions are designed to be applied automatically during database operations (ABAC), not only at the route layer.
- Implement permissions using:
  - `permissions.config.ts`
  - `@Permission('actionName')` on endpoints
  - ABAC conditions aligned with Prisma `where` filters

Unauthenticated requests are treated as a “guest context” (not a role).

---

## Permissions

### Permissions Configuration Shape

Permissions live in `src/config/permissions.config.ts`:

```ts
export const PermissionsConfig = {
  ModelName: {
    ADMIN: {
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findMany: { conditions: { id: PermissionPlaceholder.USER_ID } },
      updateMany: { conditions: { id: PermissionPlaceholder.USER_ID } },
    },
  },
};
```

### Rules

- `'ALL'` – unrestricted access
- `{ conditions: { ... } }` – ABAC filtering using Prisma-like `where` syntax

Example: allow deletion only if related refresh tokens are expired:

```ts
deleteMany: {
  conditions: {
    refreshTokens: {
      every: { expiresAt: { lt: new Date() } },
    },
  },
},
```

### Reading Related Models

When a query pulls in a relation (`include: { author: true }`, or the equivalent `select`), that related model's **own** read permissions are enforced too — a relation is never a way around ABAC. How this plays out depends on the relation's cardinality.

**To-one relations (`belongsTo`, 1:1)** are filtered with *inner-join* semantics: the related model's read `conditions` are applied to the **parent** row.

- If the related model has **no** read rule for the caller's role, including the relation raises a `403` (`Missing permissions on model X`). Grant a read rule on every model you expose through an `include`.
- If the related model has a **conditional** read rule and the specific related row does not satisfy it, the **whole parent row is dropped** from the result (`findFirst` returns `null`; `findMany` omits it) — the parent is *not* returned with the relation set to `null`. Put plainly: you cannot see a row whose related record you are not allowed to see.

**To-many relations (`hasMany`, many-to-many)** are filtered in place: the parent row is kept and the child list is narrowed to the rows the caller may read (which can be empty).

Example — `Comment.author` points at `User`, and a `User` is only self-readable:

```ts
User: {
  USER: { findMany: { conditions: { id: PermissionPlaceholder.USER_ID } } },
},
Comment: {
  USER: { findMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } } },
},
```

`comment.findFirst({ where: { id }, include: { author: true } })` returns the comment only when the caller is also its author (a `User` row they are allowed to read); otherwise the comment itself is filtered out. This is intentional and fails closed.

> **Why not return the parent with the relation nulled?** Prisma does not allow a `where` filter on a to-one relation inside `include` / `select`, so the condition is applied to the parent instead. Masking the relation while keeping the parent would require an extra query per included relation; the framework favors the single-query, fail-closed behavior.

### Action Aliases and Fallbacks

To avoid duplicated config, the permissions engine supports fallback behavior. In practice:

- Define `findMany` when possible, as it generally covers read scenarios.
- `count` may fall back to read permissions when not explicitly defined.

### Custom Controller Actions

Add custom endpoints and protect them with `@Permission(...)`.

```ts
@Permission('exportAuditReport')
@Get('/audit/export')
exportAuditReport() {
  return this.service.exportAuditReport();
}
```

### Temporarily Exposing Models

Some operations require privileged access (e.g., registration pre-checks). You can temporarily expose a model:

- Endpoint-level (decorator’s second argument), or
- Service-level scoped exposure

Endpoint-level example:

```ts
@Permission('checkEmailAvailability', ['user'])
@Get('/auth/email-available')
async isEmailAvailable(@Query('email') email: string) {
  return this.service.isEmailAvailable(email);
}
```

Service-level example:

```ts
await this.prisma.withExposedModels(['user'], async () => {
  // privileged operations here
});
```

Use this sparingly and intentionally. Prefer ABAC whenever feasible.

---

## Generated CRUD Endpoints

For each generated model/controller (subject to permissions):

- `GET /[model_name]`
- `GET /[model_name]/:id`
- `POST /[model_name]`
- `PUT /[model_name]/:id`
- `DELETE /[model_name]/:id`

To show a model in the admin backoffice, register it in `src/config/admin.config.ts`.

### Request validation (generated DTOs)

`appx-core generate` emits a `class-validator` DTO per model and action so `POST`/`PUT` bodies are validated and unknown fields are rejected (keep `setupCoreSecurity(app)` in `main.ts`, which enables `whitelist`). Two files are generated per action:

- **Base** — `src/generated/dto/<model>/<action>-<model>.generated.dto.ts`. Derived from your Prisma schema, **regenerated (overwritten) on every `generate`**, and gitignored. Do not edit it.
- **Subclass** — `src/modules/<model>/dto/<action>-<model>.dto.ts`. Generated **once** and yours to keep. Add custom validation here; it is never overwritten:

  ```ts
  import { IsEmail, Length } from 'class-validator';
  import { CreateUserGeneratedDto } from '../../../generated/dto/user/create-user.generated.dto';

  export class CreateUserDto extends CreateUserGeneratedDto {
    @IsEmail()
    email!: string;          // tighten the base @IsString()

    @Length(2, 60)
    name?: string;
  }
  ```

**What's writable.** A field appears in the DTO unless it is the primary key (`@id`), a server-managed timestamp (`@default(now())` / `@updatedAt`), or annotated non-writable. To exclude a field from all generated CRUD writes, annotate it in `schema.prisma` with a doc-comment:

```prisma
model User {
  password String? /// @Role(none)   // never read AND never CRUD-writable
  role     Role    /// @NoWrite       // not writable via CRUD (set it through a controlled flow)
}
```

Use `/// @NoWrite` to exclude a field for **all** roles. For **per-role** control (e.g. only ADMIN may set `role`), use `restrictedFields` on the permission instead of `@NoWrite`.

---

## Examples

### Example 1: Admin-Only Operational Endpoint

Use case: expose a lightweight operational endpoint to verify that background jobs ran recently.

Controller:

```ts
@Permission('viewSystemHealth')
@Get('/ops/health')
getHealth() {
  return this.service.getHealthSummary();
}
```

Permissions (`permissions.config.ts`):

```ts
export const PermissionsConfig = {
  System: {
    ADMIN: {
      viewSystemHealth: 'ALL',
    },
    USER: {
      // Not defined => denied
    },
  },
};
```

Service (example logic):

```ts
async getHealthSummary() {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
  };
}
```

### Example 2: “My Profile” Endpoint (User Can Only See Self)

Use case: ensure users can only access their own record, even if they try other IDs.

Controller:

```ts
@Permission('readMyProfile')
@Get('/me/profile')
getMyProfile() {
  return this.service.getMyProfile();
}
```

Permissions:

```ts
export const PermissionsConfig = {
  User: {
    ADMIN: { readMyProfile: 'ALL' },
    USER: { readMyProfile: { conditions: { id: PermissionPlaceholder.USER_ID } } },
  },
};
```

Service (Prisma query remains straightforward; ABAC filtering is applied by the core):

```ts
async getMyProfile() {
  return this.prisma.model.user.findFirst({
    where: { id: PermissionPlaceholder.USER_ID },
  });
}
```

### Example 3: Registration Email Availability Check

Use case: a public endpoint checks if an email is already used. This must access user data safely, even without a logged-in user.

Controller:

```ts
@Permission('checkEmailAvailability', ['user'])
@Get('/auth/email-available')
async isEmailAvailable(@Query('email') email: string) {
  return this.service.isEmailAvailable(email);
}
```

Service:

```ts
async isEmailAvailable(email: string) {
  let exists = false;

  await this.prisma.withExposedModels(['user'], async () => {
    const user = await this.prisma.model.user.findFirst({ where: { email } });
    exists = !!user;
  });

  return { available: !exists };
}
```

This pattern should be used sparingly and intentionally.

---

## Limitations

### Prisma method restrictions (permission safety)

Avoid these Prisma methods because they can bypass or complicate granular permission filtering:

- `findUnique` → use `findFirst`
- `delete` → use `deleteMany` with a single-item filter
- `update` → use `updateMany` with a single-item filter

Operational guidance:

- Prefer `findMany`, `findFirst`, `updateMany`, and `deleteMany`.
- When you intend a single-record operation, use a restrictive `where` clause.

### GraphQL status

GraphQL is part of the direction, but is **not fully ready** in the current release. REST CRUD + AdminJS are the primary integration surfaces for now.

---

## FAQ

**Are CRUD endpoints only for AdminJS?**  
No. They can be used for any API consumer. Permissions are enforced consistently.

**Do I need to treat generated modules as read-only?**  
No. Generated NestJS modules are **editable** and intended to be extended.

---

## Roadmap

Planned and under consideration:

- Production-ready GraphQL
- Object storage patterns (S3-friendly out-of-the-box support)
- Forgot-password flow
- Email templates + sending primitives
- Push notifications primitives
- WebSockets support
- Stronger testing baseline (unit tests scaffolding and patterns)
- “Agent-ready” development guidance (`agents.txt`, conventions for coding agents)
- Optional AI-assisted project scaffolding

---

## Support

Email: **core@appx-digital.com**

---

## Security

Report vulnerabilities privately to **core@appx-digital.com**. Do not open public issues for sensitive reports.

---

## Contributing

1. Fork the repository.
2. Create a feature branch.
3. Keep changes focused; add tests where applicable.
4. Open a PR with clear motivation and impact.

---

## License

MIT License. See [LICENSE](LICENSE).
