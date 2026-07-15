import {Global, Module} from '@nestjs/common';
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

@Global()
@Module({
    imports: [ConfigModule, UserModule, PassportModule.register({session: true}),
        JwtModule.registerAsync({
            imports: [ConfigModule],
            useFactory: async (config: ConfigService) => ({
                secret: config.get<string>('JWT_SECRET'),
                signOptions: {expiresIn: config.get<JwtSignOptions['expiresIn']>('JWT_EXPIRES_IN', '60m')},
            }),
            inject: [ConfigService],
        }),],
    providers: [AuthService, LocalStrategy, SessionSerializer, JwtStrategy, JwtAuthGuard, AuthenticatedGuard, RefreshTokenStrategy],
    controllers: [AuthController],
    exports: [AuthService, JwtAuthGuard, AuthenticatedGuard, JwtModule],
})
export class AuthModule {
}
