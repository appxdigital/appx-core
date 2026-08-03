import {MiddlewareConsumer, Module, NestModule, RequestMethod} from '@nestjs/common';
import {AppController} from './app.controller';
import {AppService} from './app.service';
import {ConfigModule} from '@nestjs/config';
import {AppxCoreAdminModule, AppxCoreModule, AuthModule, coreEnvFilePath, GraphqlModule, PrismaInterceptor, UserPopulationGuard} from '@appxdigital/appx-core';
import {APP_GUARD, APP_INTERCEPTOR} from '@nestjs/core';
import {RequestContextMiddleware, RequestContextModule} from 'nestjs-request-context'
import {PermissionsConfig} from './config/permissions.config';
import {AdminConfig} from './config/admin.config';
import {PrismaModule} from './prisma/prisma.module';

@Module({
    imports: [
        RequestContextModule,
        ConfigModule.forRoot({
            isGlobal: true,
            expandVariables: true,
            envFilePath: coreEnvFilePath(),
        }),
        // Provides PrismaClient + PrismaService (@Global). Everything that talks
        // to the database depends on it — AuthModule, the admin module, and every
        // generated CRUD module — so it must be registered here.
        PrismaModule,
        AppxCoreModule.forRoot(PermissionsConfig),
        AppxCoreAdminModule.forRoot(AdminConfig, PermissionsConfig),
        RequestContextModule,
        AuthModule.forRoot(),
        // Read-only GraphQL at POST /graphql (Apollo Sandbox on GET). The server
        // is always mounted; expose a model by adding CoreGraphqlResolver(...) to
        // that model's module providers (see docs/graphql.md).
        GraphqlModule,
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
