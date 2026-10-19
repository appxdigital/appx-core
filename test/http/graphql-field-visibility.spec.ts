/**
 * GraphQL with row-conditional field visibility. The fixture config gives USER
 * `ProjectMember.fields.role.visibleOnlyWhen: { userId: $USER_ID }`. `role` is a
 * required column, so the schema makes it nullable and it resolves `null` on
 * other members' rows.
 *
 * Seed: bob (USER) owns "Bob Proj"; bob and carol are members of it.
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

describe('GraphQL — field visibility', () => {
    let booted: BootedApp;
    let bobJwt: string;

    const gql = (query: string) => request(booted.server).post('/graphql').set('Authorization', `Bearer ${bobJwt}`).send({ query });

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
        const reg = await request(booted.server).post('/auth/register').send({ email: 'bob@example.com', password: 'password123' });
        if (![200, 201].includes(reg.status)) throw new Error(`Register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        await booted.withFreshDb(async (c) => {
            const bob = await c.user.findFirst({ where: { email: 'bob@example.com' } });
            const carol = await c.user.create({ data: { email: 'carol@example.com', password: 'x', role: 'USER' } });
            const project = await c.project.create({ data: { name: 'Bob Proj', ownerId: bob.id } });
            await c.projectMember.create({ data: { projectId: project.id, userId: bob.id, role: 'manager' } });
            await c.projectMember.create({ data: { projectId: project.id, userId: carol.id, role: 'contributor' } });
        });
        const login = await request(booted.server).post('/auth/login/jwt').send({ email: 'bob@example.com', password: 'password123' });
        bobJwt = login.body.access_token || login.body.accessToken;
        if (!bobJwt) throw new Error('Login failed to yield a JWT');
    });

    afterAll(async () => {
        await booted?.withFreshDb(cleanDb);
        await booted?.close();
    });

    test('a required column with a field rule is nullable in the schema; others are unchanged', async () => {
        const res = await gql('query { __type(name: "ProjectMember") { fields { name type { kind } } } }');
        const kinds = Object.fromEntries(res.body.data.__type.fields.map((f: any) => [f.name, f.type.kind]));
        expect(kinds.role).toBe('SCALAR');
        expect(kinds.projectId).toBe('NON_NULL');
    });

    test('the column resolves on matching rows and is null on the others', async () => {
        const res = await gql('query { projectMember { find(orderBy: { id: asc }) { role } } }');
        expect(res.body.errors).toBeUndefined();
        expect(res.body.data.projectMember.find).toEqual([{ role: 'manager' }, { role: null }]);
    });
});
