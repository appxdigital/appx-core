/**
 * Regression test for the request-transaction commit ordering.
 *
 * With USE_TRANSACTION=true (the scaffold default, set in the fixture .env) the
 * framework wraps each mutating request in a Prisma interactive transaction via
 * PrismaInterceptor. The success response MUST NOT be sent until that
 * transaction has committed — otherwise a client that reads immediately after a
 * 2xx can race the commit and fail to see its own write.
 *
 * This previously flaked (more often under CI load): `POST /auth/register`
 * returned 201, but a fresh connection reading right after intermittently found
 * no row. The loop below repeats the register→read-on-a-new-connection cycle
 * enough times to expose any residual race; every iteration must see the row.
 *
 * Boots with the hardened pipe to mirror the shipped scaffold.
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

const HARDENED_PIPE = { transform: true, whitelist: true, forbidNonWhitelisted: true };
const ITERATIONS = 15;

describe('Request transaction commits before responding (USE_TRANSACTION=true)', () => {
    let booted: BootedApp;

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
    });

    afterAll(async () => {
        await booted?.withFreshDb((c) => c.user.deleteMany({}));
        await booted?.close();
    });

    test('a registered user is visible to a brand-new connection immediately after the 2xx', async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            const email = `txn-user-${i}@example.com`;
            const res = await request(booted.server)
                .post('/auth/register')
                .send({ email, password: 'txnpassword1' });
            expect([200, 201]).toContain(res.status);

            // A fresh connection (not the app's pool) must observe the committed
            // row the instant the response returned — no read-after-write race.
            const row = await booted.withFreshDb((c) =>
                c.user.findFirst({ where: { email } }),
            );
            expect(row).not.toBeNull();
            expect(row.email).toBe(email);
        }
    });
});
