// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
/// <reference types="multer" />
import { FileUploadModuleOptions, EndpointConfig } from '../../common/interfaces/file-upload.interface';
import { StorageService } from '../../common/interfaces/storage-service.interface';
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
export declare class FileUploadService {
    private options;
    private storageService;
    constructor(options: FileUploadModuleOptions, storageService: StorageService);
    /**
     * Retrieves the configuration for the specified endpoint or its aliases.
     * @param endpoint - The endpoint to get the configuration for.
     */
    getEndpointConfig(endpoint: string): EndpointConfig | undefined;
    /**
     * Verifies if the user's role is allowed for the specified endpoint.
     * Skips verification if the roles array contains 'ALL'.
     * Throws a ForbiddenException if the role is not allowed.
     * @param endpointSuffix - The endpoint to check access for.
     * @param userRole - The role of the user making the request.
     */
    validateUserRole(endpointSuffix: string, userRole: string): void;
    /**
     * Uploads one or multiple files to the storage service.
     * @param file - A single file or an array of files to upload.
     * @returns The result of the upload operation(s).
     */
    uploadFile(file: Express.Multer.File | Express.Multer.File[]): Promise<any>;
}
