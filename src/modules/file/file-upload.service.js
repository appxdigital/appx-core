// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileUploadService = void 0;
const common_1 = require("@nestjs/common");
const contants_1 = require("../../common/contants");
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
let FileUploadService = exports.FileUploadService = class FileUploadService {
    constructor(options, storageService) {
        this.options = options;
        this.storageService = storageService;
    }
    /**
     * Retrieves the configuration for the specified endpoint or its aliases.
     * @param endpoint - The endpoint to get the configuration for.
     */
    getEndpointConfig(endpoint) {
        return (this.options.endpoints || []).find(config => config.endpoint === endpoint || config.aliases?.includes(endpoint));
    }
    /**
     * Verifies if the user's role is allowed for the specified endpoint.
     * Skips verification if the roles array contains 'ALL'.
     * Throws a ForbiddenException if the role is not allowed.
     * @param endpointSuffix - The endpoint to check access for.
     * @param userRole - The role of the user making the request.
     */
    validateUserRole(endpointSuffix, userRole) {
        const config = this.getEndpointConfig(endpointSuffix);
        if (!config) {
            throw new common_1.BadRequestException(`Endpoint not configured for suffix: ${endpointSuffix}`);
        }
        if (config.roles.includes('ALL')) {
            return;
        }
        if (!config.roles.includes(userRole)) {
            throw new common_1.ForbiddenException(`Your role (${userRole}) is not permitted to upload to this endpoint`);
        }
    }
    /**
     * Uploads one or multiple files to the storage service.
     * @param file - A single file or an array of files to upload.
     * @returns The result of the upload operation(s).
     */
    async uploadFile(file) {
        if (Array.isArray(file)) {
            return Promise.all(file.map((f) => this.storageService.uploadFile(f)));
        }
        else {
            return this.storageService.uploadFile(file);
        }
    }
};
exports.FileUploadService = FileUploadService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(contants_1.FILE_UPLOAD_OPTIONS)),
    __param(1, (0, common_1.Inject)(contants_1.STORAGE_SERVICE)),
    __metadata("design:paramtypes", [Object, Object])
], FileUploadService);
