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

The generated DTOs **do not include relation fields**, only scalar foreign keys. That is deliberate: generic CRUD endpoints are for **flat** writes.

**Do not try to make CRUD accept nested relation writes** (`{ tasks: { create: [...] } }`, `connect`, `set`, …) by re-adding relation keys. Two reasons:

1. Under the validation pipe, unknown relation keys are either rejected (`forbidNonWhitelisted`) or — if you ever run `whitelist` in strip mode without `forbidNonWhitelisted` — **silently dropped**, causing silent data loss on writes. Always keep `forbidNonWhitelisted` on so bad input **fails loud**.
2. Nested writes are **not authorized by ABAC** — a nested `create`/`connect` never passes through the proxy's create-enforcement, so it bypasses the create rules for the related model. Exposing them via generic CRUD is a mass-assignment / authorization risk.

For legitimate nested writes, add an **explicit controller/service method** where you apply the right authorization yourself, rather than routing them through the generic CRUD body.

---

## After changing the schema

Re-run `npx appx generate`. The `.generated.dto.ts` bases update; your hand-owned `*.dto.ts` subclasses are left untouched (so your `OmitType`/validation customizations survive). Review new/removed fields in the regenerated bases.
