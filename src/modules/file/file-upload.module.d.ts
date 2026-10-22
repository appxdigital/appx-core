// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
import { DynamicModule } from '@nestjs/common';
import { FileUploadModuleOptions } from '../../common/interfaces/file-upload.interface';
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export declare class FileUploadModule {
    static register(options: FileUploadModuleOptions): DynamicModule;
}
