# AppX Core — Documentation

Authoritative usage documentation for `@appxdigital/appx-core`. **This folder is the source of truth** for how the framework behaves — humans and AI agents should read it here rather than inferring patterns from source code. If code and these docs disagree, that is a bug in one of them; fix it, don't guess.

## Contents

- **[permissions.md](./permissions.md)** — the authorization model: the `@Permission` and `@ExposeModels` decorators, the `permissions.config.ts` shape, roles/actions, row-level `conditions`, field-level control, action fallbacks, and the `GUEST` (unauthenticated) flow.
- **[dtos.md](./dtos.md)** — the generated CRUD validation DTOs: their two-file structure, **how to remove a field** (`OmitType` / `@NoWrite` / `restrictedFields`), how to add validation, and why nested relation writes don't belong on generic CRUD.
- **[data-access.md](./data-access.md)** — how you talk to the database: the Prisma proxy (`prisma.model.*`), how ABAC filtering and field omission are enforced on every call, the redirected single-record methods, relation behaviour, bypass hatches, and transactions.
- **[graphql.md](./graphql.md)** — the **read-only** GraphQL API generated from your schema: queries, nested selections, and how ABAC filters them.
- **[limitations.md](./limitations.md)** — **known limitations and features that are NOT ready for use** (e.g. `aggregate`, GraphQL writes). Read this before relying on any method not covered in the guides above.

## The one-paragraph mental model

AppX Core wraps the Prisma client in a proxy that enforces **attribute-based access control (ABAC)** on every database call. You declare row-level and field-level rules once in `permissions.config.ts`; the proxy injects them into each query automatically based on the current request's user role. Controllers/resolvers are generated from your Prisma schema. The rules of the road: **go through the proxy** (`prismaService.model.*`) so ABAC applies, **declare a permission for every model/role/action** you want to allow (everything else is default-denied), and **check [limitations.md](./limitations.md)** before using a method.

## Conventions used in these docs

- `$USER_ID` refers to `PermissionPlaceholder.USER_ID` — a placeholder replaced with the current user's id at query time.
- "the proxy" means the `PrismaService` client returned by `prismaService.model` (and the `prisma.user` / `prisma.session` / `prisma.userRefreshToken` accessors).
- "default-deny" means: if no rule matches, the request is refused (a `403` at the guard, or a thrown `HttpException` at the proxy) — never silently allowed.
