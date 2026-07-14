/**
 * Hardcoded `role !== 'ADMIN'` checks in AuthController.
 * Partially fixed in 0.1.123 (authentication is now guarded explicitly).
 *
 * `getAllSessions` and `closeSpecificSession` (auth.controller.ts) gate access
 * with an inline `if (req.user?.role !== 'ADMIN') throw ForbiddenException`.
 *
 * Before 0.1.123 there was NO auth guard on these routes: an unauthenticated
 * request reached the role check, `req.user?.role` was undefined, `!== 'ADMIN'`
 * was true, so a 403 was thrown — correct outcome purely by accident. A refactor
 * that flipped the check (e.g. to `=== 'USER'`) would have silently opened these
 * to anonymous callers.
 *
 * 0.1.123 adds `@UseGuards(AuthenticatedGuard)` to both routes, so authentication
 * is now enforced explicitly and the accident is removed. The observable status
 * for an anonymous request is unchanged (a guard returning false also yields
 * 403), so the assertions below still hold — they now pin deliberate behaviour.
 *
 * Remaining (tracked, not yet fixed): the 'ADMIN' role string is still hardcoded
 * and outside permissions.config.ts, so a permissions audit won't surface it.
 * De-hardcoding is deferred to ROADMAP (activate RolesGuard/ROLES_ENUM).
 */
import request from 'supertest';
import { bootFixture, BootedApp } from '../helpers/fixture-bootstrap';

describe('Hardcoded ADMIN check on /auth/sessions/:userId', () => {
    let booted: BootedApp;

    beforeAll(async () => {
        // enableSession mirrors the scaffold's main.ts middleware stack
        // (passport.initialize/session). AuthenticatedGuard calls
        // req.isAuthenticated(), which only exists once passport is installed;
        // a real deployment always has it. Without it the guard would throw
        // (500) instead of denying (403).
        booted = await bootFixture({ validationPipe: 'scaffold-default', enableSession: true });
    });
    afterAll(async () => { await booted?.close(); });

    test('Unauthenticated GET /auth/sessions/1 → 403 (now via AuthenticatedGuard)', async () => {
        const res = await request(booted.server).get('/auth/sessions/1');
        expect(res.status).toBe(403);
    });

    test('Unauthenticated POST /auth/sessions/abc/close → 403 (now via AuthenticatedGuard)', async () => {
        const res = await request(booted.server).post('/auth/sessions/abc/close');
        expect(res.status).toBe(403);
    });

    // These pin that anonymous callers are denied. As of 0.1.123 the denial is
    // enforced by @UseGuards(AuthenticatedGuard) rather than the incidental
    // role-comparison, so a future edit to the role line can no longer open
    // these routes to anonymous requests.
});
