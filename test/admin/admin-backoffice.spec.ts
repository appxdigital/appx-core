/**
 * AdminJS backoffice, end to end. The fixture app + `AppxCoreAdminModule` run
 * in a plain-Node subprocess (test/helpers/admin-boot.cjs — AdminJS is ESM and
 * can't load in jest's VM); requests go over HTTP.
 *
 * Pins: only `adminRoles` can log in; resource lists go through the ABAC proxy
 * as the logged-in admin (field omission applies — `@Role(none)` password is
 * never returned, the ADMIN-only `secretApiKey` is).
 */
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import request from 'supertest';
import * as argon2 from 'argon2';
import { FIXTURE_DIR } from '../helpers/fixture-app';

describe('AdminJS backoffice', () => {
    let child: ChildProcess;
    let base: string;
    let output = '';

    const withDb = async <T,>(fn: (c: any) => Promise<T>): Promise<T> => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PrismaClient } = require(path.join(FIXTURE_DIR, 'node_modules', '.prisma', 'client'));
        const c = new PrismaClient({ datasourceUrl: process.env.APPX_FIXTURE_DB_URL });
        try {
            return await fn(c);
        } finally {
            await c.$disconnect();
        }
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

    const login = (email: string) =>
        request(base).post('/admin/login').type('form').send({ email, password: 'password123' });

    beforeAll(async () => {
        await withDb(async (c) => {
            await cleanDb(c);
            const password = await argon2.hash('password123');
            const admin = await c.user.create({ data: { email: 'admin@example.com', password, role: 'ADMIN' } });
            await c.user.create({ data: { email: 'user@example.com', password, role: 'USER' } });
            await c.project.create({ data: { name: 'Admin Proj', ownerId: admin.id, secretApiKey: 'ADMIN_SECRET' } });
        });

        child = spawn('node', [path.join(__dirname, '..', 'helpers', 'admin-boot.cjs')], {
            cwd: FIXTURE_DIR,
            env: {
                ...process.env,
                DATABASE_URL: process.env.APPX_FIXTURE_DB_URL,
                ADMIN_JS_SKIP_BUNDLE: 'true',
                SESSION_SECRET: 'admin-test-secret-admin-test-secret-0123',
                SESSION_COOKIE_NAME: 'admin_test',
            },
        });
        const port = await new Promise<string>((resolve, reject) => {
            child.stdout!.on('data', (d) => {
                output += d.toString();
                const m = output.match(/ADMIN_READY (\d+)/);
                if (m) resolve(m[1]);
            });
            child.stderr!.on('data', (d) => (output += d.toString()));
            child.on('exit', (code) => reject(new Error(`admin app exited (${code}):\n${output}`)));
        });
        base = `http://127.0.0.1:${port}`;
    });

    afterAll(async () => {
        child?.kill();
        await withDb(cleanDb);
    });

    test('serves the login page', async () => {
        const res = await request(base).get('/admin/login');
        expect(res.status).toBe(200);
    });

    test('a role outside adminRoles cannot log in', async () => {
        const res = await login('user@example.com');
        expect(res.status).toBe(200); // login page re-rendered, no redirect into the panel
        expect(res.headers.location).toBeUndefined();
    });

    test('an admin logs in and lists records through the ABAC proxy', async () => {
        const res = await login('admin@example.com');
        expect(res.status).toBe(302);
        const cookie = res.headers['set-cookie'];

        const users = await request(base).get('/admin/api/resources/User/actions/list').set('Cookie', cookie);
        expect(users.status).toBe(200);
        const emails = users.body.records.map((r: any) => r.params.email).sort();
        expect(emails).toEqual(['admin@example.com', 'user@example.com']);
        for (const r of users.body.records) expect(r.params.password).toBeUndefined(); // @Role(none)

        const projects = await request(base).get('/admin/api/resources/Project/actions/list').set('Cookie', cookie);
        expect(projects.status).toBe(200);
        expect(projects.body.records.map((r: any) => r.params.secretApiKey)).toEqual(['ADMIN_SECRET']); // @Role(ADMIN)
    });

    test('the panel API refuses an anonymous request', async () => {
        const res = await request(base).get('/admin/api/resources/User/actions/list');
        expect(res.status).toBe(302); // redirected to the login page
    });
});
