/**
 * POST /auth/refresh must work under a default-deny permissions config.
 *
 * The refresh request is unauthenticated by design (the client presents only
 * the refresh token in the body), so it runs as GUEST. The refresh-token
 * strategy's user lookup is a framework auth flow and must use
 * BYPASS_FILTERING, like every other auth-flow lookup (login, JWT population,
 * admin auth). Without it, a config that grants GUEST nothing on User — the
 * scaffold default — turns every refresh into a 403.
 */
import request from 'supertest';
import { bootFixture, resetFixtureDb, BootedApp } from '../helpers/fixture-bootstrap';

describe('POST /auth/refresh under default-deny GUEST config', () => {
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

    test('register → login/jwt → refresh returns a fresh token pair', async () => {
        const creds = { email: 'refresh@example.com', password: 'hunter2hunter' };

        const reg = await request(booted.server).post('/auth/register').send(creds);
        expect(reg.status).toBeLessThan(300);

        const login = await request(booted.server).post('/auth/login/jwt').send(creds);
        expect(login.status).toBeLessThan(300);
        expect(login.body.refresh_token).toBeTruthy();

        const refreshed = await request(booted.server)
            .post('/auth/refresh')
            .send({ refreshToken: login.body.refresh_token });
        expect(refreshed.status).toBeLessThan(300);
        expect(refreshed.body.access_token).toBeTruthy();
        expect(refreshed.body.refresh_token).toBeTruthy();
    });

    test('a garbage refresh token is rejected, not 500', async () => {
        const res = await request(booted.server)
            .post('/auth/refresh')
            .send({ refreshToken: 'not-a-real-token' });
        expect([401, 403]).toContain(res.status);
    });
});
