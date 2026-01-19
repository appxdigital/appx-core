import {MiddlewareConsumer, Module, NestModule, RequestMethod} from '@nestjs/common';
import {AppController} from './app.controller';
import {AppService} from './app.service';
import {ConfigModule} from '@nestjs/config';
import {AppxCoreAdminModule, AppxCoreModule, AuthModule, PrismaInterceptor, UserPopulationGuard} from '@appxdigital/appx-core';
import {APP_GUARD, APP_INTERCEPTOR} from '@nestjs/core';
import {RequestContextMiddleware, RequestContextModule} from 'nestjs-request-context'
import {PermissionsConfig} from './config/permissions.config';
import {AdminConfig} from './config/admin.config';

@Module({
    imports: [
        RequestContextModule,
        ConfigModule.forRoot({
            isGlobal: true,
            expandVariables: true,
            envFilePath: `.env.${process.env.NODE_ENV || 'development'}`,
        }),
        AppxCoreModule.forRoot(PermissionsConfig),
        AppxCoreAdminModule.forRoot(AdminConfig, PermissionsConfig),
        RequestContextModule,
        AuthModule,
    ],
    controllers: [AppController],
    providers: [
        AppService,
        {
            provide: APP_INTERCEPTOR,
            useClass: PrismaInterceptor,
        },
        {
            provide: APP_GUARD,
            useClass: UserPopulationGuard,
        },
    ],
})
export class AppModule implements NestModule {
    configure(consumer: MiddlewareConsumer) {
        consumer
            .apply(RequestContextMiddleware)
            .forRoutes({path: '*', method: RequestMethod.ALL});
    }
}
