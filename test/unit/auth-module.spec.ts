/**
 * AuthModule.forRoot({ controller }) contract.
 *
 * NestJS *extends* the @Module() decorator metadata onto a DynamicModule, so a
 * controller declared statically could never be removed by forRoot. This pins
 * that the controller comes ONLY from forRoot — otherwise forRoot({controller:false})
 * silently still registers AuthController and duplicates /auth routes.
 */
import 'reflect-metadata';
import { AuthModule } from '../../src/modules/auth/auth.module';
import { AuthController } from '../../src/modules/auth/auth.controller';
import { AuthService } from '../../src/modules/auth/auth.service';

describe('AuthModule.forRoot', () => {
    test('the static @Module() declares NO controllers (so forRoot can omit it)', () => {
        const staticControllers = Reflect.getMetadata('controllers', AuthModule) || [];
        expect(staticControllers).toEqual([]);
    });

    test('forRoot() registers the built-in AuthController by default', () => {
        const dyn = AuthModule.forRoot();
        expect(dyn.controllers).toContain(AuthController);
        expect(dyn.providers).toContain(AuthService);
        expect(dyn.global).toBe(true);
    });

    test('forRoot({ controller: false }) registers providers but NOT the controller', () => {
        const dyn = AuthModule.forRoot({ controller: false });
        expect(dyn.controllers).toEqual([]);
        expect(dyn.providers).toContain(AuthService); // providers still available globally
    });
});
