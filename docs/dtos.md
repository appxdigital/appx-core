# Generated CRUD DTOs

`appx generate` emits a `class-validator` DTO for each model's create and update actions. Combined with the global validation pipe (`whitelist` + `forbidNonWhitelisted`), these DTOs are what stop CRUD `POST`/`PUT` endpoints from accepting arbitrary fields (mass-assignment). This page covers what they contain, how to customize them, and — the common question — **how to remove a field**.

---

## Two files per action

For every model + action there are two files:

| File | Owned by | Edit it? |
|---|---|---|
| `src/generated/dto/<model>/<action>-<model>.generated.dto.ts` | the generator — **overwritten** every `appx generate` (gitignored) | **Never.** |
| `src/modules/<model>/dto/<action>-<model>.dto.ts` | you — generated **once**, never overwritten | **Yes — customize here.** |

The generated controller imports the **hand-owned** subclass, which by default just extends the base:

```ts
import { CreateTaskGeneratedDto } from '../../../generated/dto/task/create-task.generated.dto';

export class CreateTaskDto extends CreateTaskGeneratedDto {}
```

Put all your customizations in that subclass. Editing the `.generated.dto.ts` base is pointless — it's regenerated from the schema.

---

## What the base contains (writable-field policy)

A scalar field is **included** unless it is:

- the primary key (`@id`),
- a server-managed timestamp (`@default(now())` / `@updatedAt`),
- annotated `/// @NoWrite`,
- annotated `/// @Role(none)`.

**Relation navigation fields are excluded**; their scalar foreign keys are kept. Types map to validators: enums → `@IsEnum`, scalars → `@IsString`/`@IsInt`/`@IsBoolean`/`@IsNumber`/`@IsDateString`, `Json`/`Bytes` → `@Allow()`.

> Because relations are excluded, generic CRUD endpoints accept **flat** writes (scalars + FK ids), not nested relation writes. See [Relations & nested writes](#relations--nested-writes) below.

---

## How to remove a field

There are three ways, at different scopes. Pick the narrowest one that fits.

| Mechanism | Scope | Where you declare it |
|---|---|---|
| `OmitType(GeneratedDto, ['field'])` | this one endpoint's DTO | the hand-owned `*.dto.ts` |
| `/// @NoWrite` (or `/// @Role(none)`) | every generated DTO, every role | the Prisma schema |
| `restrictedFields: ['field']` | a specific role + action (runtime strip) | `permissions.config.ts` |

### 1. `OmitType` — remove a field for one endpoint

The subclass extends a **stripped** version of the base. `OmitType` (and its siblings) come from `@nestjs/mapped-types` (already a framework dependency):

```ts
import { OmitType } from '@nestjs/mapped-types';
import { CreateTaskGeneratedDto } from '../../../generated/dto/task/create-task.generated.dto';

// drop `reviewerId` from what this endpoint accepts
export class CreateTaskDto extends OmitType(CreateTaskGeneratedDto, ['reviewerId'] as const) {}
```

With the whitelist pipe on, a removed field is no longer part of the DTO, so a body that includes it is rejected (`forbidNonWhitelisted`) rather than written.

Related helpers, all of which preserve validation metadata:

- `PickType(Base, ['a', 'b'] as const)` — keep only these fields (inverse of `OmitType`).
- `PartialType(Base)` — make every field optional (handy for update DTOs).
- `IntersectionType(A, B)` — merge two DTOs.

### 2. `/// @NoWrite` — remove a field everywhere

Annotate the column in the Prisma schema and regenerate. The field is excluded from **all** generated create/update DTOs for **all** roles. Use this for fields that should never be client-writable (e.g. an internal status). `/// @Role(none)` has the same write-exclusion effect (and also hides the field on read).

```prisma
model Task {
  internalRef String? /// @NoWrite
}
```

### 3. `restrictedFields` — remove a field per role

Strip specific keys from the body for a given role + action, at runtime, from `permissions.config.ts`:

```ts
Task: {
  USER: { create: { conditions: { ... }, restrictedFields: ['status'] } },
}
```

Note: `restrictedFields` **strips silently** (no `400`), and only affects fields that are present in the DTO to begin with. See [permissions.md](./permissions.md#field-level-control).

---

## How to add validation

Add decorated properties (or re-declare an existing one with stricter rules) on the subclass:

```ts
import { IsEmail, MaxLength } from 'class-validator';
import { CreateUserGeneratedDto } from '../../../generated/dto/user/create-user.generated.dto';

export class CreateUserDto extends CreateUserGeneratedDto {
  @IsEmail()
  declare email: string;

  @MaxLength(120)
  declare name?: string;
}
```

You can combine this with `OmitType`/`PickType` — extend the transformed base, then add rules.

---

## Relations & nested writes

Generated **create** DTOs expose each relation as a nested-write member that accepts an explicit allowlist of operators — **`create` and `connect` only** — each authorized by ABAC. Other operators (`set`, `disconnect`, `update`, `upsert`, `delete`, …) are deliberately **not** emitted, so the validation pipe rejects them; the proxy rejects them defensively too. Both layers fail closed.

- **`create`** — creates the related record(s). Authorized against the related model's **`create`** rule (recursively, so deeper nesting is checked too). The back-reference foreign key is set automatically by the parent write and is omitted from the nested DTO.
- **`connect`** — links existing record(s) by their unique fields. Authorized against the related model's dedicated **`connect`** permission — see [permissions.md](./permissions.md). A `connect` rule is **required**; being able to *read* a record does not authorize associating it. No `connect` rule ⇒ the connect is refused.

So a nested write succeeds only when it is an allowed operator **and** the caller passes the related model's rule.

**Raw foreign keys are authorized the same way.** Setting a relation by its scalar FK (`ownerId: 7`) instead of `owner: { connect: { id: 7 } }` is not a shortcut around authorization — the framework knows `ownerId` backs the `owner` relation and checks the value against `User.connect` exactly as the `connect` form would. Every foreign key a create establishes needs a `connect` rule on its target (the sole exception is the FK Prisma fills for a child nested inside its parent, which is trusted). If a required FK's target has no `connect` rule, the app refuses to boot. See [permissions.md](./permissions.md#the-connect-action--authorizes-every-relationship-a-create-establishes).

**Only `create()` carries nested writes.** `update` resolves to `updateMany`, whose payload is scalar-only (a Prisma constraint), so nested writes are not available on update — do the update and the relation change as separate operations, or in an explicit endpoint.

Example — create a project with a new task and connect existing tags:

```jsonc
POST /projects
{
  "name": "Alpha",
  "ownerId": 1,
  "tasks": { "create": [{ "title": "kickoff" }] },  // requires Task.create rule
  "tags":  { "connect": [{ "id": 7 }] }             // requires Tag.connect rule
}
```

**Keep `forbidNonWhitelisted: true` on** so a disallowed operator (e.g. `set`) **fails loud** with a `400`. Never run `whitelist` in strip-only mode on writes — it would silently drop the payload.

### Nesting depth: one level over HTTP CRUD

The generated nested-write DTOs go **one level deep**. A nested `create` DTO contains the related model's **scalar fields only** (plus its `connect`) — it does **not** expose that model's *own* relations. This is deliberate: it keeps the generated DTOs free of circular references.

Consequence for CRUD requests:

- **One level works:** `project.create` with `tasks: { create: [...] }` or `tags: { connect: [...] }`. ✅
- **Two+ levels are rejected with `400`:** e.g. `project.create` → `tasks: { create: [{ title, comments: { create: [...] } }] }`. The inner `comments` key is not on the (scalar-only) task nested-create DTO, so `forbidNonWhitelisted` rejects it. This fails **loud**, never silently.

Note the two layers behave differently on purpose:

- **The proxy enforcement is fully recursive** — it authorizes nested `create`/`connect` at *any* depth (each level checked against that model's `create` / `connect` rule). So deep nesting is safe wherever it can reach the proxy.
- **The generated DTOs cap the HTTP surface at one level.** Deep nesting simply isn't expressible through generic CRUD.

**To do multi-level nested writes, use an explicit controller/service method** that calls `prismaService.model.<x>.create(...)` with the deep payload — the proxy still enforces the `create`/`connect` allowlist recursively there. Do not try to widen the generated DTOs to accept deeper nesting.

---

## After changing the schema

Re-run `npx appx generate`. The `.generated.dto.ts` bases update; your hand-owned `*.dto.ts` subclasses are left untouched (so your `OmitType`/validation customizations survive). Review new/removed fields in the regenerated bases.
