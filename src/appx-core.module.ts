import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { PermissionsConfigProvider, PERMISSIONS_CONFIG_TOKEN } from './common/config/permissions.config.provider';
import { PermissionsConfigType } from './common/config/permissionsConfigTypes';
import { PermissionsService } from './common/config/permissions.service';
@Global()
@Module({})
export class AppxCoreModule {
    static forRoot(config?: PermissionsConfigType): DynamicModule {
        const customPermissionsProvider: Provider = {
            provide: 'CUSTOM_PERMISSIONS_CONFIG',
            useValue: config,
        };

        return {
            module: AppxCoreModule,
            providers: [
                customPermissionsProvider,
                PermissionsConfigProvider,
                PermissionsService,
            ],
            exports: [
                PermissionsConfigProvider,
                PermissionsService,
                PERMISSIONS_CONFIG_TOKEN,
            ],
        };
    }
}
