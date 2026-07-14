/**
 * Generated CRUD POST/PUT validate the request body against a per-model DTO.
 *
 * The generator emits a class-validator DTO per model+action and the generated
 * controller overrides create/update with that concrete DTO as the @Body type.
 * Combined with the hardened pipe (whitelist + forbidNonWhitelisted, from
 * setupCoreSecurity), unknown / non-writable fields are rejected with 400.
 *
 * Writable-field policy (schema-derived): excludes @id, server-managed
 * timestamps, /// @NoWrite, and /// @Role(none). So on User, `id` and
 * `password` (@Role(none)) are not accepted by POST /users.
 *
 * Boots with the hardened pipe to mirror the shipped scaffold.
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

const HARDENED_PIPE = { transform: true, whitelist: true, forbidNonWhitelisted: true };

describe('POST /users body validation on generated CRUD', () => {
    let booted: BootedApp;
    let adminJwt: string;

    beforeAll(async () => {
        booted = await bootFixture({ validationPipe: HARDENED_PIPE });

        // Clean prior test users that share this DB across spec files.
        await booted.withFreshDb(async (c) => {
            await c.userRefreshToken.deleteMany({});
            await c.session.deleteMany({});
            await c.user.deleteMany({});
        });

        // Seed an ADMIN. Register (email+password only — role is no longer
        // accepted at register under the hardened pipe) to get a hashed
        // password, then promote to ADMIN directly in the DB.
        const reg = await request(booted.server)
            .post('/auth/register')
            .send({ email: 'admin@example.com', password: 'adminpw123' });
        if (![200, 201].includes(reg.status)) {
            throw new Error(`Register failed: ${reg.status} ${JSON.stringify(reg.body)}`);
        }
        await booted.withFreshDb((c) =>
            c.user.update({ where: { email: 'admin@example.com' }, data: { role: 'ADMIN' } }),
        );

        // Login via JWT.
        const loginRes = await request(booted.server)
            .post('/auth/login/jwt')
            .send({ email: 'admin@example.com', password: 'adminpw123' });

        adminJwt = loginRes.body.access_token || loginRes.body.accessToken;
        if (!adminJwt) {
            throw new Error(
                `Login did not return a JWT. status=${loginRes.status} body=${JSON.stringify(loginRes.body)}`,
            );
        }
    });

    afterAll(async () => { await booted?.close(); });

    test('ADMIN POST /users with a client-supplied id is rejected (400)', async () => {
        // id is @id — excluded from the DTO. forbidNonWhitelisted → 400.
        const res = await request(booted.server)
            .post('/users')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ id: 9999, email: 'extra@example.com', role: 'USER' });
        expect(res.status).toBe(400);

        const u = await booted.withFreshDb((c) =>
            c.user.findFirst({ where: { id: 9999 } }),
        );
        expect(u).toBeNull();   // client-supplied id never reached the DB
    });

    test('non-writable field password (@Role(none)) is rejected at the HTTP layer', async () => {
        const res = await request(booted.server)
            .post('/users')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ email: 'nopass@example.com', role: 'USER', password: 'irrelevant' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/password/i);
    });

    test('arbitrary unknown field is rejected by the app (400), not by Prisma', async () => {
        const res = await request(booted.server)
            .post('/users')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ email: 'weird@example.com', role: 'USER', unexpectedField: 'x' });
        expect(res.status).toBe(400);
    });

    test('a legitimate create with only writable fields succeeds', async () => {
        const res = await request(booted.server)
            .post('/users')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ email: 'legit@example.com', name: 'Legit', role: 'USER' });
        expect([200, 201]).toContain(res.status);

        const u = await booted.withFreshDb((c) =>
            c.user.findFirst({ where: { email: 'legit@example.com' } }),
        );
        expect(u).toBeTruthy();
        expect(u.name).toBe('Legit');
    });
});
