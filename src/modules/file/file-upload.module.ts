import { Module, DynamicModule, Provider } from '@nestjs/common';
import { FileUploadService } from './file-upload.service';
import { FileUploadController } from './file-upload.controller';
import { FileUploadModuleOptions } from '../../common/interfaces/file-upload.interface';
import { AwsStorageService } from '../../common/providers/aws-storage.service';
import { LocalStorageService } from '../../common/providers/local-storage.service';
import {STORAGE_SERVICE, FILE_UPLOAD_OPTIONS} from "../../common/contants";
import {GcpStorageService} from "../../common/providers/gcp-storage.service";

@Module({})
export class FileUploadModule {
    static register(options: FileUploadModuleOptions): DynamicModule {
        const providers: Provider[] = [
            FileUploadService,
            {
                provide: FILE_UPLOAD_OPTIONS,
                useValue: options,
            },
        ];

        let storageProvider: Provider;
        switch (options.cloudProvider) {
            case 'aws':
                storageProvider = {
                    provide: STORAGE_SERVICE,
                    useClass: AwsStorageService,
                };
                break;
            case 'gcp':
                storageProvider = {
                    provide: STORAGE_SERVICE,
                    useClass: GcpStorageService,
                };
                break;
            case 'local':
                storageProvider = {
                    provide: STORAGE_SERVICE,
                    useClass: LocalStorageService,
                };
                break;
            default:
                throw new Error('Unsupported cloud provider');
        }

        providers.push(storageProvider);

        return {
            module: FileUploadModule,
            controllers: [FileUploadController],
            providers: providers,
            exports: [FileUploadService],
        };
    }
}
