# Prerelease log

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
