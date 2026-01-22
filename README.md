# AppX Core

<p align="center">
  <img src="./public/appx-core-logo.png" alt="AppX Core Logo" width="220" />
</p>

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

### 2) Create a New Project

```bash
appx-core create
cd <your-project>
```

### 3) Configure Environment

Create a `.env` file at the project root:

```bash
## DataBase Configurations ##
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=generic
DB_PROVIDER=mysql
DB_URL="${DB_PROVIDER}://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

## Project configurations ##
APP_PORT=3000
USE_TRANSACTION=true

## Sessions ##
SESSION_SECRET="change-me"
SESSION_COOKIE_NAME="session_nestjs-project"
SESSION_TTL=86400

## JWT ##
JWT_EXPIRES_IN=10d
JWT_REFRESH_EXPIRES_IN=1y
JWT_SECRET="change-me"
JWT_REFRESH_SECRET="change-me"
```

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

After you edit `schema.prisma`, run:

```bash
appx-core generate
```

Run this **every time** you change the Prisma schema. This is the only required generation step (no need to run `prisma generate` separately).

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
