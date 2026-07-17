# Permissions & Authorization

How AppX Core decides **who may do what**. Two layers cooperate:

1. **`RbacGuard`** (route level) — checks that the caller's role has *a* permission for the requested action on the model. Coarse allow/deny; does **not** evaluate row conditions.
2. **The Prisma proxy** (data level) — injects the row-level `conditions` and applies field-level omission on every query. This is the real enforcement layer. See [data-access.md](./data-access.md).

Both read the same `permissions.config.ts`.

---

## The permissions config

Lives in `src/config/permissions.config.ts` and is passed to `AppxCoreModule.forRoot(PermissionsConfig)`.

```ts
import { PermissionPlaceholder, PermissionsConfigType } from '@appxdigital/appx-core';

const $UID = PermissionPlaceholder.USER_ID;

export const PermissionsConfig: PermissionsConfigType = {
  Project: {                       // model name (matches the Prisma model)
    ADMIN: {                       // role (matches your Role enum / role strings)
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findMany: { conditions: { OR: [{ ownerId: $UID }, { members: { some: { userId: $UID } } }] } },
      create:   { conditions: { ownerId: $UID } },
      updateMany: { conditions: { ownerId: $UID } },
    },
    GUEST: {                       // unauthenticated requests — see "GUEST" below
      findMany: 'ALL',
    },
  },
};
```

Shape: `PermissionsConfig[Model][Role][action]`, where each `action` value is either:

- **`'ALL'`** — unrestricted for that action, or
- **`{ conditions: <where> }`** — an ABAC rule. `conditions` is Prisma `where`-syntax (`AND`/`OR`/`NOT`, relation filters `some`/`every`/`none`, operators `in`/`not`/`lt`/…). `$USER_ID` is substituted with the caller's id at query time.
- Optionally with **`restrictedFields`** and/or **`setUserIdField`** (see below).

**Model and role keys are matched case-insensitively** against the model name and the caller's role string.

### Actions

| Action | Triggered by |
|---|---|
| `findMany`, `findFirst` | reads |
| `count` | counts |
| `create`, `createMany` | inserts |
| `updateMany` | updates (also what `update()` resolves to — see [data-access.md](./data-access.md)) |
| `deleteMany` | deletes (also what `delete()` resolves to) |

> `aggregate` is **not** a supported permission action yet — see [limitations.md](./limitations.md).

### Action fallback chains

To keep configs compact, a missing action falls back:

- **`count` → `findMany` → `findFirst`** (reads share a rule).
- **`findFirst` / `findUnique`-shape reads → `findMany`**.
- **`createMany` → `create`**, **`updateMany` → `update`**, **`deleteMany` → `delete`** (a batch action inherits the singular rule).

The `*Many` → singular fallback is **one-directional**: the singular is canonical. Declaring only `updateMany` does *not* enable `update`; declare `update` (or `create`/`delete`) and the `*Many` form is covered automatically. This holds in **both** the `RbacGuard` and the proxy.

So a minimal USER config often needs just `findMany`, `create`, `update`, `delete`.

### Field-level control

- **`/// @Role(ADMIN)` on a schema column** — only listed roles can *read* that field. For everyone else the proxy omits it from results (it comes back `undefined`). `/// @Role(none)` hides it from all roles. Applies at every depth, including nested relation selections.
- **`/// @NoWrite` on a schema column** — excludes the field from generated create/update DTOs (all roles).
- **`restrictedFields: ['x', 'y']` on a permission action** — strips those keys from the incoming request body for that role+action (e.g. stop a role from setting `role`/`id`). Silent strip, not a `400`.
- **`setUserIdField: 'ownerId'`** — the framework sets that field to the caller's id server-side on create (so a client can't forge ownership). Applied after `restrictedFields`, so it can't be clobbered.

---

## Decorators

### `@Permission(action, exposeModels?)`

Declares the action a route requires. Read by `RbacGuard` (enforces the role has the action) and by the interceptor (for `exposeModels`).

```ts
@Permission('findMany')
@Get()
list() { /* ... */ }
```

- `RbacGuard` looks up `PermissionsConfig[model][role][action]`; if absent (after fallbacks) it throws `403`. `model` comes from the controller's `entityName`.
- **`RbacGuard` is auto-applied on `CoreController`** (all generated CRUD controllers). On a **custom** controller, add `@UseGuards(RbacGuard)` yourself if you want the action enforced.
- The optional second argument exposes models for the request — see below.

### `@ExposeModels(...models)`

Exposes one or more models for the duration of the request **without** requiring a permission action.

```ts
@ExposeModels('user')      // no @Permission needed
@Get('/auth/email-available')
isEmailAvailable(@Query('email') email: string) { /* reads User unfiltered */ }
```

- Sets **no action**, so `RbacGuard` demands no permission (a public / `GUEST` route works with no `GUEST` rule for the model).
- The listed models **skip row and field filtering for that request only** (scoped via async context — it does not make the model globally readable).
- Case-insensitive: `@ExposeModels('User')` and `@ExposeModels('user')` are equivalent.
- Combine with `@Permission(...)` if you also want an action check — exposed models from both decorators are merged.
- This is a deliberate **bypass**. Use it narrowly (e.g. registration pre-checks); prefer real ABAC rules where feasible.

> `@Permission(action, ['user'])` still exposes models exactly as before — `@ExposeModels` is the permission-free alternative, not a replacement.

---

## The GUEST (unauthenticated) flow

A request with **no session and no valid JWT** is treated as the role **`GUEST`**:

- The global `UserPopulationGuard` never blocks — it populates `req.user` from a `Bearer` JWT if present, otherwise leaves the request unauthenticated and passes through.
- `RbacGuard` defaults the role to `'GUEST'` and looks up `PermissionsConfig[model]['GUEST'][action]`. If you declared a `GUEST` rule, the route is allowed; otherwise it is default-denied (`403`).
- The proxy likewise resolves the role to `GUEST` and applies `GUEST` conditions (or default-denies).

So to allow public access to a model, add a `GUEST` block to its config. To allow public access to a route that reads a model you *don't* want generally public, use `@ExposeModels(...)` instead.

---

## Default-deny

If a model/role/action has no rule (after fallbacks) and the model is not exposed:

- `RbacGuard` throws `ForbiddenException` (`403`).
- The proxy throws `HttpException(403)`.

There is no "allow by omission". A typo in a role or model key means that path is denied.
