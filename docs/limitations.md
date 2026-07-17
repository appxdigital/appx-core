# Known Limitations & Not-Ready Features

Read this before using any method or surface not explicitly covered in [permissions.md](./permissions.md) / [data-access.md](./data-access.md). Items here are either **not ready for use**, or **behave differently from vanilla Prisma** in ways you must account for.

---

## Not ready — do not use yet

### `aggregate`

`prisma.model.<model>.aggregate(...)` is **not a supported ABAC action**. There is no `aggregate` permission and no fallback to a read rule, and the field-omission logic isn't designed for aggregate argument shapes. Its ABAC behaviour is undefined/untested — **avoid it for user-scoped data**.

- Need a count? Use `count(...)` — it **is** supported and falls back to your `findMany` rule.
- Need a genuine aggregate behind trusted access? Compute it inside a `withExposedModels(...)` block (or a bypass) with your own authorization, and never expose it to untrusted roles until aggregate ABAC lands.

### GraphQL

The GraphQL surface is **marked "not fully ready"** and should not be treated as a hardened production API yet:

- **Mutations are disabled** — only the `findAll` / `findOne` / `findFirst` / `aggregate` **queries** are wired (and `aggregate` carries the caveat above).
- Query resolvers route through the proxy, so **row-level ABAC applies**, but they carry **no `@Permission` guard** — the action-name check that REST routes get is absent. A hand-written resolver that touches the raw client bypasses ABAC entirely; always go through `prismaService.model.*`.
- **Field omission governs the output projection only.** The generated GraphQL input types expose every scalar column for `where` / `orderBy`, so a field that is omitted from results is still **filterable and sortable**. Do not treat an omitted field as unqueryable — control GraphQL read access at the **model** level (don't expose the model to a role that shouldn't touch the field at all).
- Introspection is enabled outside production by default, and there is no query depth/complexity limit — fine for internal use, review before public exposure.

---

## Behaves differently from vanilla Prisma

### Single-record methods are redirected

`findUnique` → `findFirst`, `findUniqueOrThrow` → `findFirstOrThrow`, `update` → `updateMany`, `delete` → `deleteMany` (types + runtime). `update()`/`delete()` return `{ count }`, not the record, and act on all matching rows. Full contract in [data-access.md](./data-access.md#method-contract-important).

### Including an unreadable to-one relation drops the parent row

`include`/`select` of a `belongsTo` relation whose target the caller can't read removes the **whole parent row** (returns `null` / omits it), rather than nulling just the relation. To-many relations filter in place and keep the parent. Fails closed; intentional. See [data-access.md](./data-access.md#relations-in-conditions-and-includes).

### `_count` pseudo-field filtering is not implemented

You can `select: { _count: ... }`, but ABAC conditions are **not** applied inside a `_count` sub-selection. Don't rely on `_count` to reflect only rows the caller may see.

---

## Sharp edges to know about

- **`restrictedFields` strips silently.** Listed fields are removed from the request body with no `400`. It only affects fields that are present in the generated DTO (not `/// @NoWrite` ones). Decide per model whether silent stripping is acceptable.
- **Per-call bypass options are only on three accessors.** `{ BYPASS_FILTERING, BYPASS_OMISSION }` are available on `prismaService.user` / `.session` / `.userRefreshToken`. For an unfiltered read of another model, use `withExposedModels([...])` or `@ExposeModels(...)`, not a per-call option on `prisma.model.<x>`.
- **Role strings are not type-checked.** `PermissionsConfig` keys are plain strings; a typo (`ADIMN`) silently yields "no permissions" → default-deny for that role. Double-check role spelling against your `Role` enum.
- **No audit logging of denials.** A refused request returns `403` but emits no structured audit event; per-request diagnostics are opt-in via `prismaService.debugQueries(true)`.
- **Exposed models are a full bypass.** `@ExposeModels` / `@Permission(a, [models])` / `withExposedModels` disable row *and* field filtering for the listed models within that scope. Keep the scope as narrow as possible.

---

## Reporting

If the framework does something these docs don't describe, that's a documentation or framework bug — surface it rather than coding around it. These docs are the source of truth.
