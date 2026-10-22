// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
/// <reference types="multer" />
import { StorageService } from '../interfaces/storage-service.interface';
export declare class LocalStorageService implements StorageService {
    private readonly uploadDir;
    constructor();
    uploadFile(file: Express.Multer.File): Promise<any>;
}
