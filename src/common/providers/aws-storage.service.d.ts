// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
/// <reference types="multer" />
import { ConfigService } from '@nestjs/config';
import { StorageService } from "../interfaces/storage-service.interface";
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export declare class AwsStorageService implements StorageService {
    private configService;
    private s3;
    private readonly bucketName;
    constructor(configService: ConfigService);
    uploadFile(file: Express.Multer.File): Promise<any>;
}
