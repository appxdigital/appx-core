import {Inject, Injectable, BadRequestException, ForbiddenException} from '@nestjs/common';
import {FileUploadModuleOptions, EndpointConfig} from '../../common/interfaces/file-upload.interface';
import {StorageService} from '../../common/interfaces/storage-service.interface';
import {STORAGE_SERVICE, FILE_UPLOAD_OPTIONS} from "../../common/contants";

@Injectable()
export class FileUploadService {
    constructor(
        @Inject(FILE_UPLOAD_OPTIONS) private options: FileUploadModuleOptions,
        @Inject(STORAGE_SERVICE) private storageService: StorageService,
    ) {
    }
    
    /**
     * Retrieves the configuration for the specified endpoint or its aliases.
     * @param endpoint - The endpoint to get the configuration for.
     */
    getEndpointConfig(endpoint: string): EndpointConfig | undefined {
        return this.options.endpoints.find(
            config => config.endpoint === endpoint || config.aliases?.includes(endpoint)
        );
    }

    /**
     * Verifies if the user's role is allowed for the specified endpoint.
     * Skips verification if the roles array contains 'ALL'.
     * Throws a ForbiddenException if the role is not allowed.
     * @param endpointSuffix - The endpoint to check access for.
     * @param userRole - The role of the user making the request.
     */
    validateUserRole(endpointSuffix: string, userRole: string) {
        const config = this.getEndpointConfig(endpointSuffix);
        if (!config) {
            throw new BadRequestException(`Endpoint not configured for suffix: ${endpointSuffix}`);
        }
        if (config.roles.includes('ALL')) {
            return;
        }

        if (!config.roles.includes(userRole)) {
            throw new ForbiddenException(`Your role (${userRole}) is not permitted to upload to this endpoint`);
        }
    }

    /**
     * Uploads one or multiple files to the storage service.
     * @param file - A single file or an array of files to upload.
     * @returns The result of the upload operation(s).
     */
    async uploadFile(file: Express.Multer.File | Express.Multer.File[]): Promise<any> {
        if (Array.isArray(file)) {
            return Promise.all(file.map((f) => this.storageService.uploadFile(f)));
        } else {
            return this.storageService.uploadFile(file);
        }
    }
}
