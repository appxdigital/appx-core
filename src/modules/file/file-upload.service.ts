import { Inject, Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileUploadModuleOptions, EndpointConfig } from '../../common/interfaces/file-upload.interface';
import { StorageService } from '../../common/interfaces/storage-service.interface';
import { STORAGE_SERVICE } from "../../common/contants";

@Injectable()
export class FileUploadService {
    constructor(
        @Inject('FILE_UPLOAD_OPTIONS') private options: FileUploadModuleOptions,
        @Inject(STORAGE_SERVICE) private storageService: StorageService,
    ) {}

    getEndpointConfig(endpointSuffix: string): EndpointConfig | undefined {
        return this.options.endpoints.find(config => config.endpoint === endpointSuffix);
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

    async uploadFile(file: Express.Multer.File) {
        return this.storageService.uploadFile(file);
    }
}
