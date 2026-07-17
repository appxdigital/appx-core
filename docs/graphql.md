# GraphQL (read API)

AppX Core can expose a **read-only GraphQL API** generated from your Prisma schema. Queries run through the same ABAC proxy as REST, so row-level filtering and field omission apply automatically.

> **Scope:** only **read** queries are available today — `findAll<Model>s`, `findOne<Model>`, `findFirst<Model>`. Writes (create/update/delete mutations) are **not available yet**; see [limitations.md](./limitations.md). Use the REST CRUD endpoints for writes.

---

## Queries

For each model, the generated schema provides:

| Query | Returns |
|---|---|
| `findAll<Model>s(...)` | a list |
| `findFirst<Model>(...)` | the first match, or `null` |
| `findOne<Model>(where: {...})` | a single record, or `null` |

```graphql
query {
  findAllProjects(where: { status: "active" }) {
    id
    name
  }
}
```

These route through `PrismaService`, so the caller's role and the rules in `permissions.config.ts` are enforced exactly as they are for REST reads (see [permissions.md](./permissions.md) and [data-access.md](./data-access.md)). A user only ever receives rows and fields their role is permitted to read.

---

## Nested queries

You can select related models inline, to any depth:

```graphql
query {
  findAllProjects {
    id
    name
    tasks {
      title
      assignee {
        name
      }
    }
  }
}
```

Nested selections are **ABAC-filtered** just like the top level.

> **Caveat — inaccessible nested data comes back empty, not as an error.** If the current user isn't allowed to read a related record, it is simply filtered out:
> - a **to-many** relation (`tasks`, `members`, …) returns an **empty list** for the parts the user can't see;
> - an **inaccessible to-one** relation causes the **parent row to be omitted** from the result (you can't see a row whose related record you aren't allowed to read).
>
> No exception is thrown — the data you're not entitled to just isn't there. Design your queries and UI to treat "empty" as "not visible to you", not "does not exist".

---

## Field-level visibility

Columns annotated `/// @Role(...)` follow the same rules as everywhere else: a role that can't read a field won't receive it in the GraphQL response, at the top level and nested. See [permissions.md](./permissions.md#field-level-control).

---

## Not available yet

- **Mutations** (create/update/delete) — use REST.
- **`aggregate`** — not ready; see [limitations.md](./limitations.md).

Always let the generated resolvers (which go through `PrismaService`) serve the data — a custom resolver that reaches the raw Prisma client would not get ABAC.
