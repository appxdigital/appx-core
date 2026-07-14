/**
 * Scaffold CORS is hardcoded to http://localhost:3000
 * with credentials: true.
 *
 * Until a real consumer overrides main.ts, a deployed app accepts cookies
 * from only one origin. The test below asserts the as-shipped behaviour:
 * - localhost:3000 → Access-Control-Allow-Origin header echoed
 * - any other origin → no CORS header (browsers will block)
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

describe('Scaffold CORS is hardcoded', () => {
    let booted: BootedApp;

    beforeAll(async () => {
        // Don't pass cors: false — let the fixture apply the scaffold default.
        booted = await bootFixture({ validationPipe: 'scaffold-default' });
    });
    afterAll(async () => { await booted?.close(); });

    test('CORS preflight from localhost:3000 is accepted', async () => {
        const res = await request(booted.server)
            .options('/auth/register')
            .set('Origin', 'http://localhost:3000')
            .set('Access-Control-Request-Method', 'POST');
        expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
        expect(res.headers['access-control-allow-credentials']).toBe('true');
    });

    test('CORS preflight from a different origin gets no allow-origin header', async () => {
        const res = await request(booted.server)
            .options('/auth/register')
            .set('Origin', 'https://other.example')
            .set('Access-Control-Request-Method', 'POST');
        // Express CORS middleware omits the header (or sends 204 with no
        // allow-origin) when origin doesn't match. The browser will block.
        expect(res.headers['access-control-allow-origin']).not.toBe('https://other.example');
    });
});
