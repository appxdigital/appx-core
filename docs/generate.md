# Code generation — `generate` and `generate models`

AppX Core generates code from your Prisma schema through **two commands with different responsibilities**. The split exists so that keeping generated types in sync (automatable) is separate from scaffolding CRUD modules (which writes code you own and edits `app.module.ts`).

| Command | What it does | Writes | Safe in CI? |
|---|---|---|---|
| `appx-core generate` | Regenerate the Prisma client, GraphQL types, and DTO **base** classes | `src/generated/**` only (gitignored) | **Yes** — idempotent, no code mutation |
| `appx-core generate models` | Scaffold + register CRUD modules for chosen models | `src/modules/**` and `src/app.module.ts` | No — run during development |

## `appx-core generate` — the deploy-safe pass

```bash
appx-core generate
```

Runs `prisma generate` (which emits both the Prisma client and the prisma-nestjs-graphql artifacts) and regenerates the DTO base classes under `src/generated/dto/**`. It **never** writes `src/modules/**` and **never** edits `src/app.module.ts`, so it can run in CI, a `postinstall`, or a predeploy step, and is idempotent.

Run it **every time you change the Prisma schema** — it refreshes the client, GraphQL types, and DTO bases in one step (no separate `prisma generate` needed). Because everything it writes lives under the gitignored `src/generated/`, it never produces a diff in your committed code.

## `appx-core generate models` — the module wizard

```bash
appx-core generate models            # interactive picker
appx-core generate models Habit Log  # named models (Pascal or kebab)
appx-core generate models --all      # every generatable model
```

For each selected model it scaffolds the hand-owned files — module, service, controller, resolver, and the DTO subclass — **once** (never overwriting your edits), registers the module in `app.module.ts`, and then runs the deploy-safe pass so the new imports resolve.

The interactive picker lists **only models that don't already have a module**. If there are none, it prints `No modules available to generate`.

### You don't need a module for every table

Generated CRUD supports **permission-gated nested writes** (`create` / `connect`), so you can expose a parent resource and write related rows through it. Scaffold modules only for the resources you actually serve over HTTP/GraphQL — not mechanically for every table.

### `User` is framework-owned

The `User` model is never scaffolded. Authentication already serves user endpoints under `/auth/*`, and a generic `POST/PUT /users` CRUD is a mass-assignment surface. If you genuinely need generic user CRUD, write it by hand — but prefer a dedicated, permission-scoped endpoint.

### Ownership is by model, not folder name

Whether a model "already has a module" is determined by the model it serves (`CoreController<Model>` / `CoreService<Model>`), not by a folder-name convention. So a hand-written module under a non-canonical folder (e.g. a pluralised `wearable-connections/` serving `WearableConnection`) is recognised, and the wizard will **not** scaffold a duplicate.

## Typical workflow

```bash
# 1. Edit prisma/schema.prisma, then:
npx prisma migrate dev        # apply the schema change
appx-core generate            # refresh client / GraphQL / DTO bases (safe)
appx-core generate models     # expose the new table(s) as CRUD (pick them)
```

In CI / deploy, run **only** `appx-core generate` — it will never touch your committed code.

## GraphQL

Scaffolded modules include a **read-only** GraphQL resolver (query + aggregate; no mutations). See [graphql.md](./graphql.md). Per-module GraphQL toggling is planned for a later release.
