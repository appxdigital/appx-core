// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
import { FileUploadService } from './file-upload.service';
import { Request as ExpressRequest } from 'express';
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export declare class FileUploadController {
    private fileUploadService;
    constructor(fileUploadService: FileUploadService);
    upload(req: ExpressRequest): Promise<{
        message: string;
        data: any[];
    }>;
}
