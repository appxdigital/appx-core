/**
 * GraphQL read API goes through the SAME ABAC proxy as REST.
 *
 * The fixture opts `Project` into GraphQL (namespaced read resolver via the
 * generated `ProjectResolver`), exposing `project { find get count }`. Every
 * operation resolves through `PrismaService.getModelDelegate`, so this proves
 * end-to-end that over GraphQL:
 *   - unauthorized ROWS are not returned (row filtering + `count`),
 *   - unauthorized FIELDS come back null — role-gated (`secretApiKey` @Role(ADMIN))
 *     and never-readable (`owner.password` @Role(none)), top level and nested,
 *   - an inaccessible nested RECORD (to-one `owner`) is filtered while the parent
 *     stays accessible,
 *   - to-one relations are nested-selectable; to-many relations are NOT (no nested
 *     pagination — query lists at the top level),
 *   - you can only filter/sort by fields you can read (presence checks excepted),
 *   - a malformed filter value is a clean error, not a 500 that leaks Prisma,
 *   - GUEST gets nothing; aliases + multiple operations resolve in one request.
 *
 * Seed: bob (USER) owns "Bob Proj"; alice (USER) owns "Alice Proj" (bob can't see)
 * and "Shared Proj" (bob is a MEMBER, so he accesses the project but not its
 * owner alice — User read is self-only). admin is an ADMIN.
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

describe('GraphQL read API is ABAC-enforced (project { find get count })', () => {
    let booted: BootedApp;
    let userJwt: string; // "bob", a USER
    let adminJwt: string; // an ADMIN

    const gql = (query: string, jwt?: string) => {
        const req = request(booted.server).post('/graphql').send({ query });
        return jwt ? req.set('Authorization', `Bearer ${jwt}`) : req;
    };

    const cleanDb = (c: any) =>
        (async () => {
            await c.comment.deleteMany({});
            await c.task.deleteMany({});
            await c.projectMember.deleteMany({});
            await c.project.deleteMany({});
            await c.userRefreshToken.deleteMany({});
            await c.session.deleteMany({});
            await c.user.deleteMany({});
        })();

    beforeAll(async () => {
        booted = await bootFixture();
        await booted.withFreshDb(cleanDb);

        for (const email of ['bob@example.com', 'admin@example.com']) {
            const reg = await request(booted.server)
                .post('/auth/register')
                .send({ email, password: 'password123' });
            if (![200, 201].includes(reg.status)) {
                throw new Error(`Register ${email} failed: ${reg.status} ${JSON.stringify(reg.body)}`);
            }
        }

        await booted.withFreshDb(async (c) => {
            await c.user.update({ where: { email: 'admin@example.com' }, data: { role: 'ADMIN' } });
            const bob = await c.user.findFirst({ where: { email: 'bob@example.com' } });
            const alice = await c.user.create({ data: { email: 'alice@example.com', password: 'x', role: 'USER' } });
            await c.project.create({ data: { name: 'Bob Proj', ownerId: bob.id, secretApiKey: 'BOB_SECRET' } });
            const aliceProj = await c.project.create({ data: { name: 'Alice Proj', ownerId: alice.id, secretApiKey: 'ALICE_SECRET' } });
            // Owned by alice, but bob is a MEMBER: bob can access the project record
            // (membership) yet not its owner alice (User read is self-only).
            const shared = await c.project.create({ data: { name: 'Shared Proj', ownerId: alice.id, secretApiKey: 'SHARED_SECRET' } });
            await c.projectMember.create({ data: { projectId: shared.id, userId: bob.id, role: 'contributor' } });
            // A second membership on a project bob CANNOT access — so ProjectMember
            // (a compound-name model) reads are provably ABAC-filtered: admin sees
            // both rows, bob sees only his Shared-Proj membership.
            await c.projectMember.create({ data: { projectId: aliceProj.id, userId: alice.id, role: 'contributor' } });
        });

        const loginBob = await request(booted.server)
            .post('/auth/login/jwt')
            .send({ email: 'bob@example.com', password: 'password123' });
        userJwt = loginBob.body.access_token || loginBob.body.accessToken;
        const loginAdmin = await request(booted.server)
            .post('/auth/login/jwt')
            .send({ email: 'admin@example.com', password: 'password123' });
        adminJwt = loginAdmin.body.access_token || loginAdmin.body.accessToken;
        if (!userJwt || !adminJwt) throw new Error('Login failed to yield JWTs');
    });

    afterAll(async () => {
        await booted?.withFreshDb(cleanDb);
        await booted?.close();
    });

    // ── sanity ───────────────────────────────────────────────────────────────
    test('the `project` namespace query is exposed', async () => {
        const res = await gql('query { project { count } }', adminJwt);
        expect(res.status).toBe(200);
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.count).toBe(3);
    });

    // ── compound-name model resolves + is ABAC-filtered ─────────────────────
    // `getModelDelegate` must map the PascalCase class name to Prisma's camelCase
    // delegate (`ProjectMember` → `projectMember`). Whole-lowercasing produced
    // `projectmember`, which isn't a delegate key, so every op 500'd with
    // "Model ProjectMember not found in PrismaClient." (single-word `project`
    // survived by coincidence). These assert the delegate resolves AND that ABAC
    // still filters across the compound-name path.
    test('compound-name model (ProjectMember) resolves — no "not found in PrismaClient"', async () => {
        const res = await gql('query { projectMember { count } }', adminJwt);
        expect(res.status).toBe(200);
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.projectMember.count).toBe(2);
    });

    test('ProjectMember reads are ABAC-filtered — USER sees only accessible memberships', async () => {
        const userCount = await gql('query { projectMember { count } }', userJwt);
        expect(userCount.body.errors).toBeUndefined();
        expect(userCount.body.data.projectMember.count).toBe(1); // only bob's Shared-Proj membership

        const res = await gql(
            'query { projectMember { find { role project { name } user { email } } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        const rows = res.body.data.projectMember.find;
        expect(rows).toHaveLength(1);
        expect(rows[0].project.name).toBe('Shared Proj'); // nested to-one resolves through the compound delegate
        expect(rows[0].user.email).toBe('bob@example.com'); // bob may read his own User row
    });

    // ── native field resolvers shape output (@FieldRequires source columns) ──
    // A hand-written `@Resolver(() => Project)` (see enableFixtureProjectFields)
    // adds: status (in-place override reading `name` via @FieldRequires), slug
    // (computed from `name`), hasSecret (computed from the @Role(ADMIN)
    // secretApiKey, no @FieldRequires → fallback), nameEchoMisdeclared (precision
    // proof). @FieldRequires source columns are resolved via a bootstrap registry,
    // so they work for new fields, in-place overrides, and nested relations.
    test('@FieldRequires on an in-place override fetches another column (status reads name)', async () => {
        // Select ONLY status. status overrides a real column AND reads `name`;
        // @FieldRequires('name') must pull name even though the client didn't select it.
        const res = await gql('query { project { get(where: { name: { equals: "Bob Proj" } }) { status } } }', userJwt);
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.get.status).toBe('ACTIVE:Bob Proj');
    });

    test('computed field derived from an unselected column resolves (@FieldRequires)', async () => {
        // Select ONLY slug — not name. slug declares @FieldRequires('name').
        const res = await gql('query { project { get(where: { name: { equals: "Bob Proj" } }) { slug } } }', userJwt);
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.get.slug).toBe('bob-proj');
    });

    test('nested field resolvers get their source columns too (recurses into relations)', async () => {
        // bob's ProjectMember → nested project (Shared Proj). The nested Project's
        // status (override) + slug (computed) both read `name`, which is NOT
        // selected — proving @FieldRequires resolves on nested relations.
        const res = await gql(
            'query { projectMember { find { project { status slug } } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        const rows = res.body.data.projectMember.find;
        expect(rows).toHaveLength(1);
        expect(rows[0].project.status).toBe('ACTIVE:Shared Proj'); // nested override read name
        expect(rows[0].project.slug).toBe('shared-proj'); // nested computed field read name
    });

    test('@FieldRequires fetches only the declared column (precise, no over-fetch)', async () => {
        // nameEchoMisdeclared declares requires:['status'] but reads `name`.
        // Only `status` is fetched, so `name` is absent and it resolves null —
        // proving the declared columns (not all scalars) drive the fetch.
        const res = await gql(
            'query { project { get(where: { name: { equals: "Bob Proj" } }) { nameEchoMisdeclared } } }',
            adminJwt,
        );
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.get.nameEchoMisdeclared).toBeNull();
    });

    test('computed field over a @Role-restricted column respects ABAC (never sees hidden data)', async () => {
        const q = `query { project { get(where: { name: { equals: "Bob Proj" } }) { hasSecret } } }`;
        const asUser = await gql(q, userJwt);
        expect(asUser.body.errors).toBeUndefined();
        expect(asUser.body.data.project.get.hasSecret).toBe(false); // secretApiKey omitted for USER → never fetched

        const asAdmin = await gql(q, adminJwt);
        expect(asAdmin.body.data.project.get.hasSecret).toBe(true); // ADMIN may read it
    });

    // ── unauthorized ROWS are not returned ───────────────────────────────────
    test('USER find returns only accessible rows (owned + member), not others', async () => {
        const res = await gql('query { project { find { id name } } }', userJwt);
        expect(res.body.errors).toBeUndefined();
        const names = res.body.data.project.find.map((p: any) => p.name).sort();
        expect(names).toEqual(['Bob Proj', 'Shared Proj']);
        expect(names).not.toContain('Alice Proj');
    });

    test('ADMIN find returns all rows', async () => {
        const res = await gql('query { project { find { id name } } }', adminJwt);
        const names = res.body.data.project.find.map((p: any) => p.name).sort();
        expect(names).toEqual(['Alice Proj', 'Bob Proj', 'Shared Proj']);
    });

    test('count is ABAC-filtered — USER counts only accessible rows (no total leak)', async () => {
        const userCount = await gql('query { project { count } }', userJwt);
        expect(userCount.body.data.project.count).toBe(2);
        const adminCount = await gql('query { project { count } }', adminJwt);
        expect(adminCount.body.data.project.count).toBe(3);
    });

    test('USER cannot fetch an unauthorized row even by direct where (get → null)', async () => {
        const res = await gql(
            'query { project { get(where: { name: { equals: "Alice Proj" } }) { id name } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.get).toBeNull();
    });

    // ── unauthorized FIELDS are not returned ─────────────────────────────────
    test('role-gated field (secretApiKey @Role(ADMIN)) is null for USER, present for ADMIN', async () => {
        const q = `query { project { get(where: { name: { equals: "Bob Proj" } }) { name secretApiKey } } }`;
        const asUser = await gql(q, userJwt);
        expect(asUser.body.errors).toBeUndefined();
        expect(asUser.body.data.project.get.name).toBe('Bob Proj');
        expect(asUser.body.data.project.get.secretApiKey).toBeNull();

        const asAdmin = await gql(q, adminJwt);
        expect(asAdmin.body.data.project.get.secretApiKey).toBe('BOB_SECRET');
    });

    test('nested restricted field (owner.password @Role(none)) is omitted, sibling present', async () => {
        const res = await gql(
            'query { project { get(where: { name: { equals: "Bob Proj" } }) { owner { email password } } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        const owner = res.body.data.project.get.owner;
        expect(owner.email).toBe('bob@example.com');
        expect(owner.password).toBeNull();
    });

    // ── nested relations: to-one selectable, to-many not ─────────────────────
    test('to-one relations are nested-selectable; to-many relations are not', async () => {
        const one = await gql(
            'query { project { get(where: { name: { equals: "Bob Proj" } }) { name owner { email } } } }',
            userJwt,
        );
        expect(one.body.errors).toBeUndefined();
        expect(one.body.data.project.get.owner.email).toBe('bob@example.com');

        // `tasks` (to-many) is not exposed for nested selection → schema error.
        const many = await gql(
            'query { project { get(where: { name: { equals: "Bob Proj" } }) { tasks { title } } } }',
            userJwt,
        );
        expect(many.body.errors).toBeDefined();
        expect(many.body.data ?? null).toBeNull();
    });

    test('accessible record, inaccessible nested to-one record — the nested record is filtered', async () => {
        // bob can access Shared Proj (member)...
        const canSee = await gql(
            'query { project { get(where: { name: { equals: "Shared Proj" } }) { name } } }',
            userJwt,
        );
        expect(canSee.body.errors).toBeUndefined();
        expect(canSee.body.data.project.get?.name).toBe('Shared Proj');
        // ...but its owner alice is not readable to bob — the nested owner record
        // must not leak (whether the proxy nulls it or drops the parent).
        const nested = await gql(
            'query { project { get(where: { name: { equals: "Shared Proj" } }) { name owner { email } } } }',
            userJwt,
        );
        expect(nested.body.errors).toBeUndefined();
        expect(JSON.stringify(nested.body.data)).not.toContain('alice@example.com');
    });

    // ── filter/sort limited to readable fields ───────────────────────────────
    test('USER cannot filter by a field it cannot read', async () => {
        const res = await gql(
            'query { project { get(where: { secretApiKey: { equals: "BOB_SECRET" } }) { id } } }',
            userJwt,
        );
        expect(res.body.errors).toBeDefined();
        expect(res.body.data?.project?.get ?? null).toBeNull();
    });

    test('ADMIN (who can read the field) CAN filter by it', async () => {
        const res = await gql(
            'query { project { get(where: { secretApiKey: { equals: "BOB_SECRET" } }) { name } } }',
            adminJwt,
        );
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.get.name).toBe('Bob Proj');
    });

    test('USER cannot count filtered by an unreadable field', async () => {
        const res = await gql(
            'query { project { count(where: { secretApiKey: { contains: "SECRET" } }) } }',
            userJwt,
        );
        expect(res.body.errors).toBeDefined();
    });

    test('USER cannot order by an unreadable field', async () => {
        const res = await gql('query { project { find(orderBy: { secretApiKey: asc }) { id } } }', userJwt);
        expect(res.body.errors).toBeDefined();
    });

    test('USER cannot filter by an unreadable field on a nested relation', async () => {
        const res = await gql(
            'query { project { find(where: { owner: { is: { password: { startsWith: "x" } } } }) { id } } }',
            userJwt,
        );
        expect(res.body.errors).toBeDefined();
    });

    test('filtering by a readable field still works', async () => {
        const res = await gql(
            'query { project { find(where: { name: { contains: "Bob" } }) { name } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.find.map((p: any) => p.name)).toEqual(['Bob Proj']);
    });

    test('presence/nullness check on a hidden field is allowed (no value revealed)', async () => {
        const notNull = await gql(
            'query { project { find(where: { secretApiKey: { not: null } }) { name secretApiKey } } }',
            userJwt,
        );
        expect(notNull.body.errors).toBeUndefined();
        expect(notNull.body.data.project.find.map((p: any) => p.name)).toContain('Bob Proj');
        expect(notNull.body.data.project.find.every((p: any) => p.secretApiKey === null)).toBe(true);

        const isNull = await gql('query { project { count(where: { secretApiKey: { equals: null } }) } }', userJwt);
        expect(isNull.body.errors).toBeUndefined();
        expect(typeof isNull.body.data.project.count).toBe('number');
    });

    test('a value-bearing predicate on a hidden field is still rejected (even via not)', async () => {
        const res = await gql(
            'query { project { find(where: { secretApiKey: { not: "BOB_SECRET" } }) { id } } }',
            userJwt,
        );
        expect(res.body.errors).toBeDefined();
    });

    // ── malformed input is a clean error, never a 500 / Prisma leak ──────────
    test('a malformed filter value does not 500 or leak a Prisma error', async () => {
        const res = await gql(
            'query { project { find(where: { createdAt: { gt: 2024 } }) { id } } }',
            userJwt,
        );
        expect(res.status).not.toBe(500);
        expect(res.body.errors).toBeDefined();
        expect(JSON.stringify(res.body.errors)).not.toMatch(/PrismaClientValidationError|invocation|prisma\./i);
    });

    // ── anonymous ────────────────────────────────────────────────────────────
    test('GUEST (no token) cannot read — errors, no data leak', async () => {
        const res = await gql('query { project { find { id name } } }');
        expect(res.body.errors).toBeDefined();
        expect(res.body.data?.project?.find ?? null).toBeNull();
    });

    // ── aliases + multiple operations ────────────────────────────────────────
    test('aliases and multiple operations resolve in one request', async () => {
        const res = await gql('query { project { mine: find { name } total: count } }', userJwt);
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.mine.map((p: any) => p.name).sort()).toEqual(['Bob Proj', 'Shared Proj']);
        expect(res.body.data.project.total).toBe(2);
    });
});
