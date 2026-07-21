# Prerelease log

> ## ⚠️ Every `0.1.121-beta.x` is part of a SECURITY-hardening release — a required migration applies
>
> Adopting any `0.1.121` beta from `0.1.120` (or earlier) requires the **mandatory migration in [`CHANGELOG.md`](./CHANGELOG.md) under `[0.1.121]`** — most importantly **regenerating the per-model DTOs and wiring them into your controllers** (`npx appx generate` + adding the DTO-typed `create`/`update` overrides to every generated controller). **Bumping the version without doing this leaves generated `POST`/`PUT` endpoints accepting arbitrary fields.**
>
> The per-build notes below are **incremental deltas relative to the previous beta**. When an entry says "no code change" or "regenerate not required", it means *nothing new to do versus the prior beta* — it does **not** waive the `[0.1.121]` migration you owe when coming from `0.1.120`.
>
> **AI agents:** do not report a `0.1.121` upgrade as done until the `CHANGELOG.md [0.1.121]` migration steps 1–5 are applied and the project builds.

Granular notes for **alpha / beta** builds of both packages —
`@appxdigital/appx-core` (library) and `@appxdigital/appx-core-cli` (CLI) —
newest first. Entries are labelled by package. These are the builds you install
to test a change in a real project before it ships:

```bash
npm install @appxdigital/appx-core@beta            # library, latest beta
npm install @appxdigital/appx-core@0.1.121-beta.0  # a specific library build
npx  @appxdigital/appx-core-cli@beta create        # CLI, latest beta
```

Each prerelease gets its own entry here with fine-grained notes. When a version
is promoted to production it is **collapsed** into a single curated section in
[`CHANGELOG.md`](./CHANGELOG.md) with aggregated changes and consolidated
migration steps — that public changelog is the one an upgrading project reads.
Nothing here is a substitute for it.

Prereleases are excluded from normal semver range resolution, so a project on
`^0.1.x` never pulls one by accident — you always opt in via the `@beta` /
`@alpha` tag or an exact version.

---

## [0.1.121-beta.12] — unreleased

**Library.** **Relationship authorization moved entirely to the `connect` action, with boot-time config validation.** Two fixes from an adopter report plus the model change:

- **Fix — create condition vs the `connect` form.** A create condition on a scalar FK (`{ ownerId: $USER_ID }`) is now satisfied when the association is supplied via `owner: { connect: { id } }`, not only the raw scalar. Resolved from relation metadata (no naming assumptions).
- **Model change (behaviour restriction — review on upgrade).** A `create` condition judges the model's **own scalar fields only**; **every foreign-key reference a create establishes — raw scalar FK, `connect`, or nested `create` — is authorized by the target model's `connect` rule** (default-deny, no bypass). The auto-filled back-FK to a same-request nesting parent is trusted. This fixes nested `create`s whose child rule referenced the parent (previously a spurious `403`) and closes the raw-FK bypass.
- **Boot validation.** The config is checked against the schema at startup: a required FK whose target has no `connect` rule for a creating role, or a `create` condition that references a relation, **rejects boot** (optional FK → warning). The error names each missing `<Model>.<Role>.connect`.
- **Migration is mandatory** — see the `[0.1.121]` banner in `CHANGELOG.md` (“Relationship authorization moved to `connect`”). Move relation-reaching create conditions to `connect` rules and add a `connect` rule for every FK-referenced model. An agent doing the migration must warn the developer.

## [0.1.121-beta.11] — unreleased

**Docs.** No code change. Documented that nested writes over HTTP CRUD are
**one level deep** (a nested `create` DTO exposes the related model's scalars +
`connect`, not its own relations, to avoid circular DTOs). The proxy's
authorization is recursive; the DTO surface is the cap — deeper nesting `400`s,
and multi-level nested writes belong in an explicit endpoint. See `docs/dtos.md`
and `docs/limitations.md`.

## [0.1.121-beta.10] — unreleased

**Library.** **Nested relation writes on generated CRUD are now an explicit,
permission-gated allowlist.** A `create` body may nest **`create`** and
**`connect`** on its relations; both are authorized by ABAC (`create` → the
related model's `create` rule, recursively; `connect` → the related model's new
dedicated **`connect`** permission — a `connect` rule is required, because being
able to *read* a record does not authorize associating it). Every other nested
operator (`set` / `disconnect` / `update` / `upsert` / `delete` / …) is rejected
at both the DTO layer (not emitted → `400`) and the proxy (throws). Nested
writes are available on **`create` only** (`update` resolves to `updateMany`,
which is scalar-only).

- **Behaviour restriction — review on upgrade.** If a project used other nested
  operators through CRUD, or connected models without a `connect` rule, those
  requests now fail. Add `connect` rules where needed; move unsupported nested
  writes to explicit endpoints. Keep `forbidNonWhitelisted: true` (fail loud).

## [0.1.121-beta.9] — unreleased

**Docs / packaging.** No code change.

- Added a **`docs/` folder** (now shipped inside the npm package) — the
  framework's source-of-truth guide: `permissions.md` (RBAC config +
  `@Permission`/`@ExposeModels`), `data-access.md` (the Prisma proxy, ABAC
  enforcement, single-record method contract, relations, transactions) and
  `limitations.md` (not-ready features incl. `aggregate`/GraphQL, and caveats).
- **Clarified the `[0.1.121]` migration in `CHANGELOG.md`.** It is now explicit
  that regenerating the per-model DTOs and wiring them into every controller is
  **mandatory** (it is the mass-assignment fix), and that a version bump without
  it leaves `POST`/`PUT` endpoints accepting arbitrary fields.

## [0.1.121-beta.8] — unreleased

**Library.**

- **Single-record data-access methods now have an honest typed contract.**
  `prisma.model.*` re-aliases the methods that can't carry ABAC conditions, in
  both the types and the runtime dispatch: `findUnique`→`findFirst`,
  `findUniqueOrThrow`→`findFirstOrThrow`, `update`→`updateMany`,
  `delete`→`deleteMany`. A mismatched call now fails at compile time instead of
  the old runtime throw. **Breaking (types only):** `update()`/`delete()` return
  `{ count }` and `findUnique()` takes a non-unique `where` with a nullable
  return — adjust the call sites the compiler flags. A `*Many` permission action
  now inherits its singular rule (`updateMany`→`update`, `deleteMany`→`delete`,
  `createMany`→`create`), so a config can declare just `update`/`delete`/`create`.
- **`@ExposeModels(...models)`** — expose models on a route WITHOUT a permission
  action, for public / GUEST endpoints that must read an otherwise-restricted
  model without adding a `GUEST` rule for it. `@Permission(action, models)` keeps
  working unchanged. Exposed-model matching is case-insensitive.

## [0.1.121-beta.7] — unreleased

**Library.** `createMany` now inherits the `create` permission when not declared
explicitly — in both the data-access proxy and the `RbacGuard`. A
`permissions.config.ts` can declare a single `create` rule and have it cover
`createMany` too (mirrors the existing `findMany → count/findFirst` fallback).
One-directional: declaring only `createMany` does **not** enable `create`.

- If you previously duplicated `create` and `createMany`, the `createMany` entry
  is now redundant (harmless to keep). No action required.

## [0.1.121-beta.6] — unreleased

**Packaging.** The npm tarball now ships `CHANGELOG.md`, `PRERELEASES.md`, and
`RELEASING.md` (previously only `dist/` + `README.md`). Migration steps are now
readable from inside an installed `node_modules/@appxdigital/appx-core`, so an
upgrading project (or an AI agent) can apply them without cloning the repo. No
code change.

## [0.1.121-beta.5] — unreleased

**Library.** Field-level access control (`/// @Role(...)`) now applies to
**nested** relation selections, not just top-level fields. Previously a query
that selected a restricted field *through* a relation
(`select: { relation: { select: { restrictedField: true } } }`) received that
field; the data-access proxy now omits it at every depth, for both `select` and
`include`, while preserving any `where` / `orderBy` you set on the relation.

- Exercise reads that pull fields through relations (nested `select` / `include`,
  including multi-level) and confirm the values you expect still come back — a
  field annotated `@Role(<roles>)` should be absent for roles not listed.
- No API change; regenerate is not required.

## [0.1.121-beta.0] — unreleased

First prerelease of the `0.1.121` hardening set. Testing target before this is
promoted to `latest`. Full aggregated notes and migration live under
`[0.1.121]` in `CHANGELOG.md`; the highlights to exercise in a project:

- **`setupCoreSecurity(app, options?)`** — one call for the global
  `ValidationPipe` (whitelist + `forbidNonWhitelisted`), CORS, and Helmet.
  Verify existing DTOs still accept every field they legitimately take (the
  whitelist rejects undeclared body properties with `400`).
- **`buildCoreSessionOptions(...)`** — requires a session secret ≥ 32 chars and
  sets hardened cookie flags. Confirm your env provides the secret.
- **`coreEnvFilePath()`** — `['.env.${NODE_ENV}', '.env']`; throws if
  `NODE_ENV` is unset. Confirm boot scripts set `NODE_ENV`.
- **Per-model generated DTOs** — regenerate (`appx generate`) and check the
  generated controllers compile and accept your writable fields.
- **Create-permission enforcement in the data-access proxy** — `create` /
  `createMany` now validate incoming data against the permission conditions and
  default-deny when a model/role has no `create` permission. Exercise every
  create path in the consuming app and confirm intended creates still succeed;
  set explicit `create` permissions (or `ALL`) where needed.

> How to try it: bump this package to `0.1.121-beta.0` in the project under
> test (`npm install @appxdigital/appx-core@beta`), run the app's own suite,
> and smoke-test create/update flows and boot. Report back before promotion.
