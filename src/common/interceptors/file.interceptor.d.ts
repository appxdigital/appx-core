// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
import { NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { FileUploadService } from '../../modules/file/file-upload.service';
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export declare class FileUploadInterceptor implements NestInterceptor {
    private fileUploadService;
    constructor(fileUploadService: FileUploadService);
    intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>>;
}
