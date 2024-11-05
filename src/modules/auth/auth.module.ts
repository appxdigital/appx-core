import {Module} from '@nestjs/common';
import {AuthService} from './auth.service';
import {AuthController} from './auth.controller';
import {UserModule} from '../user/user.module';
import {LocalStrategy} from './local.strategy';
import {PassportModule} from '@nestjs/passport';
import {SessionSerializer} from './session/session-serializer';
import {ConfigModule} from "@nestjs/config";

@Module({
    imports: [ConfigModule, UserModule, PassportModule.register({session: true})],
    providers: [AuthService, LocalStrategy, SessionSerializer],
    controllers: [AuthController],
    exports: [AuthService],
})
export class AuthModule {
}
