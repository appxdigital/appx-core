/**
 * Generated CRUD POST/PUT validate the request body against a per-model DTO.
 *
 * The generator emits a class-validator DTO per model+action and the generated
 * controller overrides create/update with that concrete DTO as the @Body type.
 * Combined with the hardened pipe (whitelist + forbidNonWhitelisted, from
 * setupCoreSecurity), unknown / non-writable fields are rejected with 400.
 *
 * Writable-field policy (schema-derived): excludes @id, server-managed
 * timestamps, /// @NoWrite, and /// @Role(none). Exercised here on TypeSample:
 * `id` (@id), `secret` (@Role(none)) and `internalNote` (@NoWrite) are not
 * accepted by POST /type-samples; every scalar-typed writable field is.
 *
 * Boots with the hardened pipe to mirror the shipped scaffold.
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

const HARDENED_PIPE = { transform: true, whitelist: true, forbidNonWhitelisted: true };

// A complete, valid TypeSample create body (all required writable fields).
// `amount` (Decimal) as a string and `big` (BigInt) as a number exercise both
// accepted wire forms.
const validTypeSample = () => ({
    text: 'hello',
    flag: true,
    count: 3,
    ratio: 1.5,
    dueAt: new Date('2030-01-02T03:04:05.000Z').toISOString(),
    priority: 'LOW',
    meta: { a: 1 },
    amount: '12.50',
    big: 42,
});

describe('POST /type-samples body validation on generated CRUD', () => {
    let booted: BootedApp;
    let adminJwt: string;

    beforeAll(async () => {
        booted = await bootFixture({ validationPipe: HARDENED_PIPE });

        // Clean prior rows that share this DB across spec files.
        await booted.withFreshDb(async (c) => {
            await c.typeSample.deleteMany({});
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

    test('ADMIN POST /type-samples with a client-supplied id is rejected (400)', async () => {
        // id is @id — excluded from the DTO. forbidNonWhitelisted → 400.
        const res = await request(booted.server)
            .post('/type-samples')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ id: 9999, ...validTypeSample() });
        expect(res.status).toBe(400);

        const row = await booted.withFreshDb((c) =>
            c.typeSample.findFirst({ where: { id: 9999 } }),
        );
        expect(row).toBeNull();   // client-supplied id never reached the DB
    });

    test('non-writable field secret (@Role(none)) is rejected at the HTTP layer', async () => {
        const res = await request(booted.server)
            .post('/type-samples')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ ...validTypeSample(), secret: 'irrelevant' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/secret/i);
    });

    test('non-writable field internalNote (@NoWrite) is rejected at the HTTP layer', async () => {
        const res = await request(booted.server)
            .post('/type-samples')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ ...validTypeSample(), internalNote: 'irrelevant' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/internalNote/i);
    });

    test('arbitrary unknown field is rejected by the app (400), not by Prisma', async () => {
        const res = await request(booted.server)
            .post('/type-samples')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ ...validTypeSample(), unexpectedField: 'x' });
        expect(res.status).toBe(400);
    });

    test('a legitimate create with only writable fields succeeds (and DateTime coerces from an ISO string)', async () => {
        const res = await request(booted.server)
            .post('/type-samples')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send(validTypeSample());
        expect([200, 201]).toContain(res.status);
        // BigInt columns serialize as a string in the JSON response (not a 500).
        expect(res.body.big).toBe('42');

        const row = await booted.withFreshDb((c) =>
            c.typeSample.findFirst({ where: { text: 'hello' } }),
        );
        expect(row).toBeTruthy();
        expect(row.count).toBe(3);
        // @Type(() => Date) coerced the ISO string to a real Date before Prisma.
        expect(row.dueAt instanceof Date).toBe(true);
        // @DecimalField coerced the "12.50" string to a Prisma.Decimal.
        expect(row.amount.toString()).toBe('12.5');
        // @BigIntField coerced the number 42 to a bigint.
        expect(typeof row.big).toBe('bigint');
        expect(row.big).toBe(42n);
    });

    test('a non-numeric Decimal is rejected at the HTTP layer (400)', async () => {
        const res = await request(booted.server)
            .post('/type-samples')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ ...validTypeSample(), amount: 'not-a-number' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/amount/i);
    });

    test('a non-integer BigInt is rejected at the HTTP layer (400)', async () => {
        const res = await request(booted.server)
            .post('/type-samples')
            .set('Authorization', `Bearer ${adminJwt}`)
            .send({ ...validTypeSample(), big: 'nope' });
        expect(res.status).toBe(400);
        expect(JSON.stringify(res.body)).toMatch(/big/i);
    });
});
