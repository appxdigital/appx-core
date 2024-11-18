// import { Module } from '@nestjs/common';
// import { ConfigModule } from '@nestjs/config';
// import { APP_INTERCEPTOR } from '@nestjs/core';
// import { AppController } from './app.controller';
// import { AppService } from './app.service';
// import {AppxCoreModule, AuthModule, PrismaInterceptor} from 'appx_core';
// import { RequestContextModule } from 'nestjs-request-context';
// import { UserModule } from './modules/user/user.module';
// import {PermissionsConfig} from "./config/permissions.config";
// import {createAdminJsModule} from "./backoffice/admin";
//
// @Module({
//     imports: [
//         ConfigModule.forRoot({
//             isGlobal: true,
//             expandVariables: true,
//         }),
//         AppxCoreModule.forRoot(PermissionsConfig),
//         RequestContextModule,
//         AuthModule,
//         UserModule,
//         createAdminJsModule().then((AdminJsModule : any) => AdminJsModule),
//     ],
//     controllers: [AppController],
//     providers: [
//         AppService,
//         {
//             provide: APP_INTERCEPTOR,
//             useClass: PrismaInterceptor,
//         },
//     ],
// })
// export class AppModule {}
