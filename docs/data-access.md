# Data Access & ABAC Enforcement

How you read and write the database, and exactly what the proxy does to every call. Pair this with [permissions.md](./permissions.md) (which defines the rules) and [limitations.md](./limitations.md) (what not to use yet).

---

## Always go through the proxy

Inject `PrismaService` and use `prismaService.model.*`:

```ts
const projects = await this.prisma.model.project.findMany({ where: { status: 'active' } });
```

`prismaService.model` returns a proxied Prisma client. **Only calls through this proxy get ABAC.** If you reach the raw Prisma client directly (a second `PrismaClient`, raw SQL, `$queryRaw`), you bypass all filtering and field omission. There is **no defence-in-depth at the controller layer** for row rules — the proxy is the single enforcement point.

There are also three narrow typed accessors — `prismaService.user`, `prismaService.session`, `prismaService.userRefreshToken` — which are the proxied delegates for those framework models (used by auth flows, often with the bypass options below).

Model names are **case-insensitive** at the proxy (`prisma.model.project` / `prisma.model.Project` resolve the same delegate and the same config).

---

## What the proxy does on every call

For each `prisma.model.<model>.<method>(args, options?)`:

1. **Field omission** (reads only) — removes columns the role may not read (`/// @Role(...)`), recursing into nested `select`/`include` at every depth.
2. **Condition injection** — looks up `PermissionsConfig[model][role][action]`; if `'ALL'`, no filter; if `{ conditions }`, `AND`-merges them into your `where` (so your filter and the permission filter both apply); if nothing (after fallbacks), throws `403`.
3. **Executes** the (possibly rewritten) query.

The role comes from the current request's user (`GUEST` if unauthenticated). Requests run inside an async context established by the framework's middleware/interceptor.

---

## Method contract (important)

The proxy can only enforce ABAC on methods that accept a `where` it can inject conditions into. Single-record methods keyed on a unique id cannot, so they are **re-aliased** — in both the TypeScript types and at runtime:

| You call | Actually runs | Params / return you get |
|---|---|---|
| `findUnique()` | `findFirst()` | non-unique `where`, nullable result |
| `findUniqueOrThrow()` | `findFirstOrThrow()` | non-unique `where` |
| `update()` | `updateMany()` | `{ where, data }`, returns `{ count }` |
| `delete()` | `deleteMany()` | `{ where }`, returns `{ count }` |

**Consequences:**

- `update()` / `delete()` return `{ count }`, **not** the affected record. Re-read if you need the row.
- These operate on **all matching rows**, not one — always pass a `where`. With ABAC conditions injected, a cross-owner `update({ where: { id } })` affects `{ count: 0 }` rather than erroring.
- The TypeScript types reflect this: calling `update()` with a lone unique `where` and expecting a record back is a **compile error**.

Use `findMany` / `findFirst` / `findFirstOrThrow` / `updateMany` / `deleteMany` directly if you prefer the explicit names.

---

## Field omission (`@Role`)

A column annotated `/// @Role(ADMIN)` is returned only to roles in the list; for others the proxy drops it from the `select` so it comes back `undefined`. `/// @Role(none)` hides it from everyone (e.g. `password`).

- Omission applies to nested relations too: `include: { owner: true }` won't leak `owner`'s `@Role`-restricted fields to an unauthorized role.

---

## Relations in conditions and includes

- **Row conditions** may traverse relations to any depth: `{ conditions: { task: { project: { ownerId: $UID } } } }`. Both `belongsTo` (to-one) and `hasMany` / M:N (`some`/`every`/`none`) are supported. Note Prisma semantics: `every` is **true on an empty list**.
- **Including a to-one relation is inner-join filtered.** When you `include`/`select` a `belongsTo` relation, the related model's read rules are merged into the **parent** row's `where`:
  - If the related model has **no** read rule for the role, including it throws `403`. Grant a read rule on every model you expose through an `include`.
  - If the related row exists but doesn't satisfy the rule, the **whole parent row is dropped** (`findFirst` → `null`, `findMany` → the row is omitted). The parent is **not** returned with the relation set to `null`. In short: you can't see a row whose related record you're not allowed to see. This is intentional and fails closed.
- **To-many relations are filtered in place**: the parent is kept, and the child list is narrowed to the rows the caller may read (possibly empty).

---

## Bypass hatches

Use sparingly and deliberately; each disables part of the protection.

- **Per-call options** — `prisma.<accessor>.<method>(args, { BYPASS_FILTERING, BYPASS_OMISSION })`. `BYPASS_FILTERING` skips condition injection (and create-enforcement); `BYPASS_OMISSION` skips field omission. Available on the typed accessors (`prisma.user`, `prisma.session`, `prisma.userRefreshToken`).
- **`@ExposeModels(...)` / `@Permission(action, [models])`** — expose models for a request so they skip row/field filtering, scoped to the handler. See [permissions.md](./permissions.md).
- **`prismaService.withExposedModels(models, async () => { ... })`** — service-level scoped exposure for a block of code (e.g. registration pre-checks). Model names are lowercased/case-insensitive.

Framework flows that must write without a permission (registration, sessions, tokens) use `BYPASS_FILTERING`.

---

## Creates

`create` / `createMany` can't push conditions into a `WHERE`, so the proxy **validates the incoming data against the create rule's `conditions` before insert**:

- Own-scalar conditions are checked against `data`; `belongsTo` relation conditions are checked by looking up the referenced parent.
- A model/role with **no** `create` permission is **default-denied** (`403`).
- It **fails closed**: unsupported condition shapes for create (list-relation `some`/`every`/`none`, exotic operators) throw rather than silently allow. For those, use `setUserIdField` to set an owner id server-side and validate inputs in DTOs.
- In development only, a warning fires if a just-created row wouldn't satisfy the model's *read* rule (i.e. the creator couldn't read it back).

---

## Transactions

Set `USE_TRANSACTION=true` (env) to wrap each request handler in a Prisma `$transaction`; per-endpoint control via the transaction metadata. The framework commits the transaction **before** sending the HTTP response, so a read-after-write in a dependent request can't miss the write. Inside a transaction the proxy uses the request's transaction client automatically.

---

## Blocked / redirected methods — quick reference

- `findUnique` / `findUniqueOrThrow` → run as `findFirst` / `findFirstOrThrow` (see contract above).
- `update` / `delete` → run as `updateMany` / `deleteMany`.
- Raw client access, `$queryRaw`, a second `PrismaClient` → **not proxied, no ABAC**. Don't use them for user-scoped data.
- `aggregate` → see [limitations.md](./limitations.md) (not ready).
