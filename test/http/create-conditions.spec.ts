/**
 * Create-permission enforcement on generated CRUD.
 *
 * The proxy validates that the data being created satisfies the create
 * permission's `conditions` (for a relation condition it looks up the
 * referenced parent), and default-denies create for a role with no create
 * permission for the model.
 *
 * The fixture grants `ProjectMember.USER.create = { conditions: { project: {
 * ownerId: $USER_ID } } }` with no setUserIdField — a USER may only add a
 * member to a project they own. Tenant.USER has no create permission at all.
 *
 * Boots with the hardened pipe to mirror the shipped scaffold.
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

const HARDENED_PIPE = { transform: true, whitelist: true, forbidNonWhitelisted: true };

describe('Create conditions + default-deny (ProjectMember / Tenant)', () => {
    let booted: BootedApp;
    let bobJwt: string;
    let bob: any;
    let alice: any;
    let projectAlice: any;
    let projectBob: any;

    beforeAll(async () => {
        booted = await bootFixture({ validationPipe: HARDENED_PIPE });

        await booted.withFreshDb(async (c) => {
            await c.comment.deleteMany({});
            await c.task.deleteMany({});
            await c.projectMember.deleteMany({});
            await c.project.deleteMany({});
            await c.userRefreshToken.deleteMany({});
            await c.session.deleteMany({});
            await c.user.deleteMany({});
        });

        const reg = await request(booted.server)
            .post('/auth/register')
            .send({ email: 'bob@example.com', password: 'bobpassword1' });
        if (![200, 201].includes(reg.status)) {
            throw new Error(`Register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        }

        ({ bob, alice, projectAlice, projectBob } = await booted.withFreshDb(async (c) => {
            const bob = await c.user.findFirst({ where: { email: 'bob@example.com' } });
            const alice = await c.user.create({
                data: { email: 'alice@example.com', password: 'x', role: 'USER' },
            });
            const projectAlice = await c.project.create({ data: { name: 'Alice Proj', ownerId: alice.id } });
            const projectBob = await c.project.create({ data: { name: 'Bob Proj', ownerId: bob.id } });
            return { bob, alice, projectAlice, projectBob };
        }));

        const login = await request(booted.server)
            .post('/auth/login/jwt')
            .send({ email: 'bob@example.com', password: 'bobpassword1' });
        bobJwt = login.body.access_token || login.body.accessToken;
        if (!bobJwt) throw new Error(`Login failed: ${login.status} ${JSON.stringify(login.body)}`);
    });

    afterAll(async () => {
        await booted?.withFreshDb(async (c) => {
            await c.comment.deleteMany({});
            await c.task.deleteMany({});
            await c.projectMember.deleteMany({});
            await c.project.deleteMany({});
            await c.userRefreshToken.deleteMany({});
            await c.session.deleteMany({});
            await c.user.deleteMany({});
        });
        await booted?.close();
    });

    test("USER cannot create a ProjectMember in a project they don't own → 403", async () => {
        const res = await request(booted.server)
            .post('/project-members')
            .set('Authorization', `Bearer ${bobJwt}`)
            .send({ projectId: projectAlice.id, userId: bob.id, role: 'manager' });
        expect(res.status).toBe(403);

        const rows = await booted.withFreshDb((c) =>
            c.projectMember.findMany({ where: { projectId: projectAlice.id } }),
        );
        expect(rows.length).toBe(0);
    });

    test('USER can create a ProjectMember in a project they own → 201', async () => {
        const res = await request(booted.server)
            .post('/project-members')
            .set('Authorization', `Bearer ${bobJwt}`)
            .send({ projectId: projectBob.id, userId: bob.id, role: 'manager' });
        expect([200, 201]).toContain(res.status);

        const rows = await booted.withFreshDb((c) =>
            c.projectMember.findMany({ where: { projectId: projectBob.id } }),
        );
        expect(rows.length).toBe(1);
    });

    test('default-deny: USER creating a model with no create permission → 403', async () => {
        const res = await request(booted.server)
            .post('/tenants')
            .set('Authorization', `Bearer ${bobJwt}`)
            .send({ name: 'Rogue Tenant' });
        expect(res.status).toBe(403);

        const rows = await booted.withFreshDb((c) =>
            c.tenant.findMany({ where: { name: 'Rogue Tenant' } }),
        );
        expect(rows.length).toBe(0);
    });
});
