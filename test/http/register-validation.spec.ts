/**
 * Mass-assignment on POST /auth/register. FIXED in 0.1.121.
 *
 * The scaffold's main.ts previously configured `ValidationPipe({transform: true})`
 * without `whitelist: true`. RegisterDto only declares email + password, but the
 * pipe passed unknown body fields (e.g. `role: "ADMIN"`) through, and
 * AuthService.register spread the whole body into Prisma.user.create.
 *
 * The fix ships `setupCoreSecurity(app)` (called by the scaffold's main.ts),
 * which installs a ValidationPipe with `{whitelist: true, forbidNonWhitelisted:
 * true}`. This test pins the FIXED behaviour: unknown fields are rejected.
 *
 * The `setupCoreSecurity` default is exactly the options passed below; the
 * previous VULNERABLE describe block (scaffold-default `{transform:true}`) was
 * removed when the fix landed, per this file's original flip instruction.
 */
import request from 'supertest';
import { bootFixture, resetFixtureDb, BootedApp } from '../helpers/fixture-bootstrap';

describe('Hardened ValidationPipe (setupCoreSecurity default: {whitelist:true, forbidNonWhitelisted:true})', () => {
    let booted: BootedApp;

    beforeAll(async () => {
        booted = await bootFixture({
            validationPipe: {
                transform: true,
                whitelist: true,
                forbidNonWhitelisted: true,
            },
        });
    });
    afterAll(async () => { await booted?.close(); });
    beforeEach(async () => { await resetFixtureDb(booted.rawPrismaClient); });

    test('POST with role:"ADMIN" is rejected with 400', async () => {
        const res = await request(booted.server)
            .post('/auth/register')
            .send({
                email: 'extra-field@example.com',
                password: 'hunter2hunter',
                role: 'ADMIN',
            });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/role/i);
    });

    test('legitimate register {email, password} still succeeds with default role USER', async () => {
        const res = await request(booted.server)
            .post('/auth/register')
            .send({
                email: 'good@example.com',
                password: 'hunter2hunter',
            });
        expect([200, 201]).toContain(res.status);

        const u = await booted.withFreshDb((c) =>
            c.user.findFirst({ where: { email: 'good@example.com' } }),
        );
        expect(u).toBeTruthy();
        expect(u.role).toBe('USER');
    });
});
