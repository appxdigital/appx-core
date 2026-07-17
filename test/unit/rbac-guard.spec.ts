/**
 * RbacGuard create/createMany fallback (route-level authorization).
 *
 * `createMany` inherits the `create` rule when not defined explicitly, matching
 * the data-access proxy's enforcement. The fallback is one-directional:
 * declaring only `createMany` does NOT enable `create`.
 */
import { RbacGuard } from '../../src/common/guards/rbac.guard';

const reflector = (action: string) => ({ get: () => ({ action }) }) as any;

const ctx = (role: string, entityName: string) =>
    ({
        getHandler: () => ({}),
        getClass: () => ({ entityName }),
        switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as any;

describe('RbacGuard — create/createMany fallback', () => {
    test('createMany is allowed when only `create` is defined', async () => {
        const config: any = { Post: { USER: { create: { conditions: { authorId: 1 } } } } };
        const guard = new RbacGuard(reflector('createMany'), config);
        await expect(guard.canActivate(ctx('USER', 'Post'))).resolves.toBe(true);
    });

    test('explicit `createMany` still wins when present', async () => {
        const config: any = { Post: { USER: { create: 'ALL', createMany: 'ALL' } } };
        const guard = new RbacGuard(reflector('createMany'), config);
        await expect(guard.canActivate(ctx('USER', 'Post'))).resolves.toBe(true);
    });

    test('one-directional: `create` is NOT enabled by a createMany-only config', async () => {
        const config: any = { Post: { USER: { createMany: 'ALL' } } };
        const guard = new RbacGuard(reflector('create'), config);
        await expect(guard.canActivate(ctx('USER', 'Post'))).rejects.toThrow(/not allowed/i);
    });

    test('default-deny when neither create nor createMany is defined', async () => {
        const config: any = { Post: { USER: { findMany: 'ALL' } } };
        const guard = new RbacGuard(reflector('createMany'), config);
        await expect(guard.canActivate(ctx('USER', 'Post'))).rejects.toThrow(/not allowed/i);
    });
});
