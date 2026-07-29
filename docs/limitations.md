# Known Limitations & Not-Ready Features

Read this before using any method or surface not explicitly covered in [permissions.md](./permissions.md) / [data-access.md](./data-access.md). Items here are either **not ready for use**, or **behave differently from vanilla Prisma** in ways you must account for.

---

## Not ready — do not use yet

### `aggregate`

`prisma.model.<model>.aggregate(...)` is **not a supported ABAC action**. There is no `aggregate` permission and no fallback to a read rule, and the field-omission logic isn't designed for aggregate argument shapes. Its ABAC behaviour is undefined/untested — **avoid it for user-scoped data**.

- Need a count? Use `count(...)` — it **is** supported and falls back to your `findMany` rule.
- Need a genuine aggregate behind trusted access? Compute it inside a `withExposedModels(...)` block (or a bypass) with your own authorization, and never expose it to untrusted roles until aggregate ABAC lands.

### GraphQL — writes and `aggregate`

GraphQL currently supports **read queries only** (`findAll<Model>s` / `findFirst<Model>` / `findOne<Model>`), with ABAC applied. See **[graphql.md](./graphql.md)** for how to use it, including nested queries.

- **Mutations (create / update / delete) are not available yet** — use the REST CRUD endpoints for writes.
- **`aggregate` is not ready** — same caveat as REST above.

Let the generated resolvers serve the data (they go through `PrismaService`); a custom resolver that reaches the raw Prisma client would not get ABAC.

---

## Behaves differently from vanilla Prisma

### Single-record methods are redirected

`findUnique` → `findFirst`, `findUniqueOrThrow` → `findFirstOrThrow`, `update` → `updateMany`, `delete` → `deleteMany` (types + runtime). `update()`/`delete()` return `{ count }`, not the record, and act on all matching rows. Full contract in [data-access.md](./data-access.md#method-contract-important).

### Including an unreadable to-one relation drops the parent row

`include`/`select` of a `belongsTo` relation whose target the caller can't read removes the **whole parent row** (returns `null` / omits it), rather than nulling just the relation. To-many relations filter in place and keep the parent. Fails closed; intentional. See [data-access.md](./data-access.md#relations-in-conditions-and-includes).

### `_count` pseudo-field filtering is not implemented

You can `select: { _count: ... }`, but ABAC conditions are **not** applied inside a `_count` sub-selection. Don't rely on `_count` to reflect only rows the caller may see.

### Nested writes over HTTP CRUD are one level deep

Generated CRUD accepts nested `create`/`connect` **one level deep only** — a `project.create` may nest tasks/tags, but not a task that itself nests comments (the second level `400`s under `forbidNonWhitelisted`). The proxy's authorization is recursive; the *DTO* surface is the cap, kept one level to avoid circular DTOs. For multi-level nested writes use an explicit endpoint that calls `prismaService.model.*.create(...)`. See [dtos.md](./dtos.md#nesting-depth-one-level-over-http-crud).

---

## Sharp edges to know about

- **No per-role field strip.** A field is either writable through the generated DTO or not (`/// @NoWrite` / `OmitType`). There is no way to accept a field for one role and reject it for another on the same CRUD endpoint — model a privileged column as `/// @NoWrite` + a dedicated endpoint. (The old `restrictedFields` option was removed — see [dtos.md](./dtos.md#per-role-differences).)
- **Per-call bypass options are only on three accessors.** `{ BYPASS_FILTERING, BYPASS_OMISSION }` are available on `prismaService.user` / `.session` / `.userRefreshToken`. For an unfiltered read of another model, use `withExposedModels([...])` or `@ExposeModels(...)`, not a per-call option on `prisma.model.<x>`.
- **Role strings are not type-checked.** `PermissionsConfig` keys are plain strings; a typo (`ADIMN`) silently yields "no permissions" → default-deny for that role. Double-check role spelling against your `Role` enum.
- **No audit logging of denials.** A refused request returns `403` but emits no structured audit event; per-request diagnostics are opt-in via `prismaService.debugQueries(true)`.
- **Exposed models are a full bypass.** `@ExposeModels` / `@Permission(a, [models])` / `withExposedModels` disable row *and* field filtering for the listed models within that scope. Keep the scope as narrow as possible.
- **`connect` defaults to one rule per target model; override per relation when needed.** By default every foreign key that points at model `T` is authorized by the single `T.connect` rule for the role. When a specific relation needs a different (stricter) rule — "a class's teacher must be a teacher" — declare a **relation-scoped** `connect` on the source model (`Source[role].relations[field].connect`); it is ANDed with `T.connect`, or stands alone if `T` has none. See [permissions.md](./permissions.md#two-places-to-declare-a-connect-rule). A relation rule can only strengthen, never loosen, the target rule.
- **A string `User.id` needs its two foreign keys changed with it.** `User.id` may be `String` (uuid/cuid) instead of the scaffold's `Int` — the framework is id-type-agnostic and coerces accordingly (see [authentication.md](./authentication.md#using-a-string-uuid--cuid-userid)). But `Session.userId` and `UserRefreshToken.userId` must be switched to `String` in the same edit; leaving one as `Int` is a schema/relation mismatch Prisma will reject at migrate time. Change all three together.
- **The config is validated at boot; a bad config stops the app.** A create condition that references a relation, or a required foreign key whose target lacks a `connect` rule for a role that can create, is a startup error (not a runtime one). This is deliberate — the alternative is a silent runtime `403`. The error message names exactly what to fix.

---

## Reporting

If the framework does something these docs don't describe, that's a documentation or framework bug — surface it rather than coding around it. These docs are the source of truth.
