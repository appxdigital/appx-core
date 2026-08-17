# scaffold-app — guide for coding agents

This project is built on **`@appxdigital/appx-core`**, a NestJS/Prisma framework that enforces attribute-based access control (ABAC) on every database call through a proxy. The framework's documentation ships with the package — **`node_modules/@appxdigital/appx-core/docs/`** is the source of truth (`permissions.md`, `data-access.md`, `dtos.md`, `generate.md`, `authentication.md`, `graphql.md`, `testing.md`, `storage.md`, `limitations.md`). Read the relevant page before inferring behaviour from framework source; if code and docs disagree, that is a bug — surface it, don't code around it.

## Data access

- Always go through the proxy: `prismaService.model.<model>.<method>(...)`. It is the **single enforcement point** for row filtering and field omission — a second `PrismaClient`, raw SQL, or `$queryRaw` bypasses all of it. (The raw client in `test/helpers/harness.ts` is the deliberate exception, used to assert at the database level.)
- Single-record methods are aliases: `findUnique()` runs `findFirst()`, `update()` runs `updateMany()` (returns `{ count }`, not the record), `delete()` runs `deleteMany()`. They act on all matching rows — pass a restrictive `where` when you intend one record.
- `BYPASS_FILTERING` / `BYPASS_OMISSION` / `withExposedModels` disable protection for their scope. Use them only for trusted server-side flows, never to make a failing query pass.

## Permissions

- **Default-deny.** Every endpoint needs `@Permission('action')` and a matching entry in `src/config/permissions.config.ts` for each role that may call it; an undefined `[model][role][action]` is a `403`.
- A create/update that sets a foreign key needs a `connect` rule for the target model (or a relation-scoped one). See `permissions.md`.
- The config is validated at boot; a bad config stops the app **on purpose** — the error names what to fix. Fix the config, don't work around the validator.

## Generated code

- Never edit `src/generated/**` — it is regenerated output. Hand-owned code lives in `src/modules/**` (including the DTO subclasses under `src/modules/<model>/dto/`).
- After a schema change: `appx-core generate` (deploy-safe sync). For new CRUD modules: `appx-core generate models`.
- Field exposure is controlled in `prisma/schema.prisma` doc-comments: `/// @Role(ADMIN)` (readable only by listed roles), `/// @Role(none)` (never readable), `/// @NoWrite` (not writable via CRUD).

## Reads and writes

- **REST CRUD is the write surface** — the generated DTOs validate and whitelist every body.
- **GraphQL is the read surface** — `<model> { find get count }` with native pagination. Expose a model by adding its generated resolver to the module's `providers` (one line, see `graphql.md`).

## Tests

- `npm test` (requires Docker) provisions a throwaway database container and drives the real app over HTTP — see `testing.md`.
- With every schema change, extend `truncateAll` in `test/helpers/harness.ts` (children before parents).
- Every deliberately public route is one reviewed line in `PUBLIC_ROUTES` (`test/isolation.spec.ts`) — the route sweep fails on any other route a guest can reach.
- Follow the shipped conventions: actors over HTTP, fixture rows via the raw `prisma` client, assertions on the database.

## Before production

- **Remove the Hello-World placeholder** once the first real feature lands: `src/app.controller.ts`'s `getHello`, `src/app.service.ts`, and the `GET /` entry in `PUBLIC_ROUTES`. A bare placeholder route must not ship.
- Don't weaken `src/main.ts` hardening: `setupCoreSecurity`, `buildCoreSessionOptions`, and `coreEnvFilePath` fail fast on insecure config by design — never replace them with inline equivalents or defaults.
- `.env` stays out of git (already ignored); secrets are per-project and rotate out-of-band.
