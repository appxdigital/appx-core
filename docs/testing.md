# Testing

Every project created with `appx-core create` ships a ready-to-run test suite: `npm test` provisions a throwaway database container, boots the real `AppModule` with the production middleware stack, and drives it over HTTP. The database in `.env` is never touched — the only requirement is a running Docker.

```bash
npm test            # one-shot run
npm run test:watch  # watch mode
```

What happens on each run: vitest's global setup starts a disposable MySQL or PostgreSQL container (matching your `DB_PROVIDER`), pushes the Prisma schema into it, and hands its URL to the specs. Every spec file boots the app against that database; the container is destroyed when the run ends.

---

## What ships with a new project

| File | Covers |
|---|---|
| `test/app.spec.ts` | the app boots and answers on `/` |
| `test/auth.spec.ts` | register (incl. unknown-field rejection), session login → `/auth/me`, JWT login → `/auth/refresh` — asserted at the database level |
| `test/isolation.spec.ts` | **route sweep**: every route the app registers is probed as a guest; anything not in `PUBLIC_ROUTES` must deny. A new endpoint with no access rule turns this red the day it lands. |
| `test/helpers/harness.ts` | the toolkit the specs are built on (below) |
| `test/setup.ts`, `test/global-setup.ts`, `vitest.config.ts` | container lifecycle + runner config |

The harness exports:

- `startApp()` / `stopApp()` — boots `AppModule` once per spec file with the same session/passport/`setupCoreSecurity` stack as `src/main.ts`.
- `api(actor?)` — a supertest agent; pass an actor to send its JWT bearer token, none for a guest.
- `sessionAgent()` — a cookie-keeping agent for session flows (`POST /auth/login` → `/auth/me`).
- `registerActor(email?, password?)` — mints a user over real HTTP (register + JWT login) and returns `{ id, email, password, token }`.
- `prisma` — a **raw** Prisma client (no ABAC): create fixture rows and assert results with it.
- `truncateAll()` — deletes every row, children before parents; extend it as your schema grows.

---

## Writing a spec

The pattern, shown for a generated module (after `appx-core generate models`):

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { api, prisma, registerActor, startApp, stopApp, truncateAll } from './helpers/harness';

describe('projects', () => {
  beforeAll(async () => {
    await startApp();
  });
  afterAll(stopApp);
  beforeEach(truncateAll);

  it("a user cannot read another user's project", async () => {
    const alice = await registerActor();
    const bob = await registerActor();
    const row = await prisma.project.create({ data: { title: 'p', ownerId: bob.id } });

    const res = await api(alice).get(`/projects/${row.id}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
    // The database is the authority: the row is untouched.
    expect(await prisma.project.count()).toBe(1);
  });
});
```

Conventions the shipped specs follow — keep them:

- **Actors go through HTTP** (`registerActor`), **fixture rows go through raw `prisma`** — a broken permission rule can't quietly produce an empty fixture and fake a pass.
- **Assert on the database**, not only the response body. ABAC-denied `updateMany`/`deleteMany` match zero rows and still return `200` — the row count is the authority on whether isolation held.
- **Extend `truncateAll`** when you add models (children before parents).
- **A new public route is a deliberate act**: add it to `PUBLIC_ROUTES` in `test/isolation.spec.ts`, one line, reviewed.

---

## Existing projects

Projects created before the test scaffold existed can adopt it by copying the files from a fresh scaffold (or from this package's `cli/scaffold/` directory): `vitest.config.ts`, `test/`, the `test`/`test:watch` scripts, and the devDependencies listed in the [CHANGELOG](../CHANGELOG.md) migration note.
