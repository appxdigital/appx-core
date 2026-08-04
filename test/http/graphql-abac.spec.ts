/**
 * GraphQL read API goes through the SAME ABAC proxy as REST.
 *
 * The fixture opts `Project` into GraphQL (namespaced read resolver via
 * `CoreGraphqlResolver`), exposing `project { find get count }`. Every operation
 * resolves through `PrismaService.getModelDelegate`, so this proves end-to-end
 * that over GraphQL:
 *   - unauthorized ROWS are not returned (row-level filtering + `count`),
 *   - unauthorized FIELDS are not returned — a role-gated column
 *     (`Project.secretApiKey` @Role(ADMIN)) and a never-readable one
 *     (`User.password` @Role(none)) come back null even though the GraphQL type
 *     exposes them, at the top level AND nested,
 *   - relations / children are queryable (and themselves ABAC-filtered),
 *   - anonymous (GUEST) callers get nothing,
 *   - aliases + multiple operations in one request work.
 *
 * User population for GraphQL relies on UserPopulationGuard resolving the request
 * across transports (see the transformContext change) — an unauthenticated query
 * is a GUEST, a Bearer-token query is that user.
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

describe('GraphQL read API is ABAC-enforced (project { find get count })', () => {
    let booted: BootedApp;
    let userJwt: string; // "bob", a USER
    let adminJwt: string; // an ADMIN
    let bobProjectId: number;
    let aliceProjectId: number;

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

        // bob = USER (via register), admin = promoted, alice = another USER.
        for (const email of ['bob@example.com', 'admin@example.com']) {
            const reg = await request(booted.server)
                .post('/auth/register')
                .send({ email, password: 'password123' });
            if (![200, 201].includes(reg.status)) {
                throw new Error(`Register ${email} failed: ${reg.status} ${JSON.stringify(reg.body)}`);
            }
        }

        ({ bobProjectId, aliceProjectId } = await booted.withFreshDb(async (c) => {
            await c.user.update({ where: { email: 'admin@example.com' }, data: { role: 'ADMIN' } });
            const bob = await c.user.findFirst({ where: { email: 'bob@example.com' } });
            const alice = await c.user.create({ data: { email: 'alice@example.com', password: 'x', role: 'USER' } });
            const bobProject = await c.project.create({
                data: { name: 'Bob Proj', ownerId: bob.id, secretApiKey: 'BOB_SECRET' },
            });
            const aliceProject = await c.project.create({
                data: { name: 'Alice Proj', ownerId: alice.id, secretApiKey: 'ALICE_SECRET' },
            });
            // Child rows in bob's project. Both are readable by bob (Task access
            // mirrors project access), but their nested `assignee` differs:
            //  - 'Bob Task'    → assignee bob   (bob CAN read this user: self)
            //  - 'Shared Task' → assignee alice (bob CANNOT read this user)
            // so bob accesses the task RECORDS but not the alice assignee record.
            await c.task.create({ data: { title: 'Bob Task', projectId: bobProject.id, assigneeId: bob.id } });
            await c.task.create({ data: { title: 'Shared Task', projectId: bobProject.id, assigneeId: alice.id } });
            await c.task.create({ data: { title: 'Alice Task', projectId: aliceProject.id, assigneeId: alice.id } });
            return { bobProjectId: bobProject.id, aliceProjectId: aliceProject.id };
        }));

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

    // ── sanity: the namespaced schema is live ────────────────────────────────
    test('the `project` namespace query is exposed', async () => {
        const res = await gql('query { project { count } }', adminJwt);
        expect(res.status).toBe(200);
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.count).toBe(2);
    });

    // ── unauthorized ROWS are not returned ───────────────────────────────────
    test('USER find returns only accessible rows (not another user\'s project)', async () => {
        const res = await gql('query { project { find { id name } } }', userJwt);
        expect(res.body.errors).toBeUndefined();
        const names = res.body.data.project.find.map((p: any) => p.name);
        expect(names).toEqual(['Bob Proj']);
        expect(names).not.toContain('Alice Proj');
    });

    test('ADMIN find returns all rows', async () => {
        const res = await gql('query { project { find { id name } } }', adminJwt);
        const names = res.body.data.project.find.map((p: any) => p.name).sort();
        expect(names).toEqual(['Alice Proj', 'Bob Proj']);
    });

    test('count is ABAC-filtered — USER counts only accessible rows (no total leak)', async () => {
        const userCount = await gql('query { project { count } }', userJwt);
        expect(userCount.body.data.project.count).toBe(1);
        const adminCount = await gql('query { project { count } }', adminJwt);
        expect(adminCount.body.data.project.count).toBe(2);
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

    test('nested restricted field (owner.password @Role(none)) is omitted, sibling fields present', async () => {
        const res = await gql(
            'query { project { get(where: { name: { equals: "Bob Proj" } }) { owner { email password } } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        const owner = res.body.data.project.get.owner;
        expect(owner.email).toBe('bob@example.com'); // sibling readable
        expect(owner.password).toBeNull(); // never returned over GraphQL
    });

    // ── relations / children resolve (and are themselves filtered) ───────────
    test('relations / children are queryable in one request', async () => {
        const res = await gql(
            'query { project { get(where: { name: { equals: "Bob Proj" } }) { name tasks { title } } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        const proj = res.body.data.project.get;
        expect(proj.tasks.map((t: any) => t.title).sort()).toEqual(['Bob Task', 'Shared Task']);
    });

    // ── access to a record, but NOT a nested record it relates to ────────────
    test('accessible record, inaccessible nested record — the nested relation is filtered', async () => {
        const res = await gql(
            'query { project { get(where: { name: { equals: "Bob Proj" } }) { name tasks { title assignee { email } } } } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        const proj = res.body.data.project.get;
        // The project record and its task records ARE accessible to bob.
        expect(proj.name).toBe('Bob Proj');
        expect(proj.tasks.length).toBeGreaterThan(0);
        // 'Shared Task'.assignee is alice, whom bob may not read (User = self only).
        // Whether the proxy nulls the relation or drops the row, alice must never
        // appear — the nested RECORD is not returned.
        expect(JSON.stringify(proj)).not.toContain('alice@example.com');
        // ...while bob's OWN nested user record IS returned — proving genuine
        // per-record filtering, not a blanket null.
        const assignees = proj.tasks.map((t: any) => t.assignee).filter(Boolean);
        expect(assignees.some((a: any) => a.email === 'bob@example.com')).toBe(true);
    });

    // ── cannot filter / sort / distinct by a field the role can't read ───────
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
        const res = await gql(
            'query { project { find(orderBy: { secretApiKey: asc }) { id } } }',
            userJwt,
        );
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

    // ── anonymous callers get nothing ────────────────────────────────────────
    test('GUEST (no token) cannot read — errors, no data leak', async () => {
        const res = await gql('query { project { find { id name } } }');
        // Project has no GUEST rule → the proxy denies; GraphQL surfaces an error
        // and no rows.
        expect(res.body.errors).toBeDefined();
        expect(res.body.data?.project?.find ?? null).toBeNull();
    });

    // ── aliases + multiple operations in one request ─────────────────────────
    test('aliases and multiple operations resolve in one request', async () => {
        const res = await gql(
            'query { project { mine: find { name } total: count } }',
            userJwt,
        );
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.project.mine.map((p: any) => p.name)).toEqual(['Bob Proj']);
        expect(res.body.data.project.total).toBe(1);
    });
});
