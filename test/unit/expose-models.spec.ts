/**
 * @ExposeModels — expose models on a route WITHOUT a permission action, so a
 * public / GUEST endpoint can read an otherwise-restricted model without adding
 * a GUEST rule for it. Verifies the metadata it sets and that RbacGuard requires
 * no permission when there is no action.
 */
import 'reflect-metadata';
import { of } from 'rxjs';
import {
    ExposeModels,
    EXPOSE_MODELS_METADATA_KEY,
    PERMISSION_METADATA_KEY,
} from '../../src/common/decorators/permission.decorator';
import { RbacGuard } from '../../src/common/guards/rbac.guard';
import { PrismaInterceptor } from '../../src/common/interceptors/prisma.interceptor';
import { CorePrismaContext } from '../../src/prisma/prisma.service';

describe('@ExposeModels', () => {
    test('sets expose-models metadata and NO permission action', () => {
        class Ctrl {
            @ExposeModels('user', 'org')
            handler() {}
        }
        expect(Reflect.getMetadata(EXPOSE_MODELS_METADATA_KEY, Ctrl.prototype.handler)).toEqual(['user', 'org']);
        // No @Permission → no action metadata → RbacGuard demands nothing.
        expect(Reflect.getMetadata(PERMISSION_METADATA_KEY, Ctrl.prototype.handler)).toBeUndefined();
    });

    test('RbacGuard allows a no-action (expose-only) route for a GUEST with no config', async () => {
        // permission metadata carries no `action` (what an @ExposeModels-only route looks like)
        const reflector = { get: (key: string) => (key === PERMISSION_METADATA_KEY ? {} : undefined) } as any;
        const guard = new RbacGuard(reflector, {} as any);
        const ctx = {
            getHandler: () => ({}),
            getClass: () => ({ entityName: 'User' }),
            switchToHttp: () => ({ getRequest: () => ({}) }), // GUEST: no session, no user
        } as any;
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
});

describe('PrismaInterceptor — exposed-model sources', () => {
    // Drive the interceptor with mocked metadata and capture the exposedModels
    // seen by the handler (the non-transaction path runs it inside CorePrismaContext.run).
    function exposedFor(permissionMeta: any, exposeModelsMeta: any): Promise<string[] | undefined> {
        const reflector = {
            get: (key: string) => {
                if (key === PERMISSION_METADATA_KEY) return permissionMeta;
                if (key === EXPOSE_MODELS_METADATA_KEY) return exposeModelsMeta;
                return undefined; // useTransaction → falls back to default 'false'
            },
        } as any;
        const configService = { get: (_k: string, d?: string) => d ?? 'false' } as any;
        const interceptor = new PrismaInterceptor({} as any, reflector, configService);
        const ctx = {
            getType: () => 'http',
            switchToHttp: () => ({ getRequest: () => ({}) }),
            getHandler: () => ({}),
        } as any;
        return new Promise((resolve, reject) => {
            let captured: string[] | undefined;
            const next = {
                handle: () => {
                    captured = CorePrismaContext.getStore()?.exposedModels;
                    return of('ok');
                },
            } as any;
            interceptor.intercept(ctx, next).subscribe({
                next: () => undefined,
                complete: () => resolve(captured),
                error: reject,
            });
        });
    }

    test('@Permission exposed models still apply (backward compatibility)', async () => {
        expect(await exposedFor({ action: 'checkEmail', expose_models: ['user'] }, undefined)).toEqual(['user']);
    });

    test('@ExposeModels applies with no permission action', async () => {
        expect(await exposedFor(undefined, ['org'])).toEqual(['org']);
    });

    test('both sources merge', async () => {
        expect(await exposedFor({ action: 'x', expose_models: ['user'] }, ['org'])).toEqual(['user', 'org']);
    });

    test('neither → empty (unchanged default)', async () => {
        expect(await exposedFor(undefined, undefined)).toEqual([]);
    });
});
