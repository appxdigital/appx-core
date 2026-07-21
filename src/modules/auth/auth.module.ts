import {DynamicModule, Global, Module} from '@nestjs/common';
import {AuthService} from './auth.service';
import {AuthController} from './auth.controller';
import {UserModule} from '../user/user.module';
import {LocalStrategy} from './local.strategy';
import {PassportModule} from '@nestjs/passport';
import {SessionSerializer} from './session/session-serializer';
import {ConfigModule, ConfigService} from "@nestjs/config";
import {JwtModule, JwtSignOptions} from "@nestjs/jwt";
import {JwtAuthGuard} from "./jwt-auth.guard";
import {AuthenticatedGuard} from "./authenticated.guard";
import {JwtStrategy} from "./jwt.strategy";
import {RefreshTokenStrategy} from "./refresh-token.strategy";

// All wiring lives in forRoot() so the controller can be conditionally omitted.
// The @Module() decorator is intentionally empty: NestJS *extends* (concatenates)
// the decorator's metadata onto a DynamicModule, so a controller declared there
// could never be removed by forRoot({ controller: false }).
const authImports = [
    ConfigModule,
    UserModule,
    PassportModule.register({session: true}),
    JwtModule.registerAsync({
        imports: [ConfigModule],
        useFactory: async (config: ConfigService) => ({
            secret: config.get<string>('JWT_SECRET'),
            signOptions: {expiresIn: config.get<JwtSignOptions['expiresIn']>('JWT_EXPIRES_IN', '60m')},
        }),
        inject: [ConfigService],
    }),
];
const authProviders = [AuthService, LocalStrategy, SessionSerializer, JwtStrategy, JwtAuthGuard, AuthenticatedGuard, RefreshTokenStrategy];
const authExports = [AuthService, JwtAuthGuard, AuthenticatedGuard, JwtModule];

@Global()
@Module({})
export class AuthModule {
    /**
     * Wires the auth module. **Always use `AuthModule.forRoot()`** — importing the
     * bare `AuthModule` registers nothing (all wiring is here so the controller
     * can be conditionally omitted).
     *
     * `AuthModule.forRoot()` registers the built-in `AuthController` (default).
     * `AuthModule.forRoot({ controller: false })` registers every auth provider
     * globally (AuthService, Jwt, Passport, strategies, guards) but NOT the
     * controller — so you can register your OWN controller (e.g. one that
     * `extends AuthController`) at the same `/auth` prefix with no duplicate
     * route. See docs/authentication.md.
     */
    static forRoot(options?: {controller?: boolean}): DynamicModule {
        return {
            module: AuthModule,
            global: true,
            imports: authImports,
            providers: authProviders,
            controllers: options?.controller === false ? [] : [AuthController],
            exports: authExports,
        };
    }
}
