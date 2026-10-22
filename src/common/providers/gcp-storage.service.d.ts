// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
/// <reference types="multer" />
import { StorageService } from '../interfaces/storage-service.interface';
import { ConfigService } from '@nestjs/config';
export declare class GcpStorageService implements StorageService {
    private configService;
    private storage;
    private readonly bucketName;
    constructor(configService: ConfigService);
    uploadFile(file: Express.Multer.File): Promise<any>;
}
