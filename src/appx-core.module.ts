import './common/bigint-serializer'; // side effect: BigInt → string in JSON output
import {DynamicModule, Global, Module, Provider} from '@nestjs/common';
import {PermissionsConfigProvider, PERMISSIONS_CONFIG_TOKEN} from './common/config/permissions.config.provider';
import {PermissionsConfigType} from './common/config/permissionsConfigTypes';
import {PermissionsService} from './common/config/permissions.service';
import {FileUploadModule} from './modules/file/file-upload.module';
import {FileUploadModuleOptions} from './common/interfaces/file-upload.interface';

@Global()
@Module({})
export class AppxCoreModule {
    static forRoot(config?: PermissionsConfigType, fileUploadConfig?: FileUploadModuleOptions): DynamicModule {
        const customPermissionsProvider: Provider = {
            provide: 'CUSTOM_PERMISSIONS_CONFIG',
            useValue: config,
        };

        const modules = [
            PermissionsConfigProvider,
            PermissionsService,
            customPermissionsProvider,
        ];

        const imports = fileUploadConfig
            ? [FileUploadModule.register(fileUploadConfig)]
            : [];

        const exports = [
            ...modules,
            PERMISSIONS_CONFIG_TOKEN,
            ...(fileUploadConfig ? [FileUploadModule] : []),
        ];

        return {
            module: AppxCoreModule,
            imports,
            providers: modules,
            exports,
        };
    }
}
