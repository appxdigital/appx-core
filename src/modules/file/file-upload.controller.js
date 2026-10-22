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
exports.FileUploadController = void 0;
const common_1 = require("@nestjs/common");
const file_interceptor_1 = require("../../common/interceptors/file.interceptor");
const file_upload_service_1 = require("./file-upload.service");
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
let FileUploadController = exports.FileUploadController = class FileUploadController {
    constructor(fileUploadService) {
        this.fileUploadService = fileUploadService;
    }
    async upload(req) {
        const fileData = req.file || req.files;
        if (!fileData) {
            throw new common_1.BadRequestException('No file uploaded');
        }
        const files = Array.isArray(fileData) ? fileData : [fileData];
        const result = await Promise.all(files.map((file) => {
            if (file && file.originalname && file.buffer) {
                return this.fileUploadService.uploadFile(file);
            }
            else {
                throw new common_1.BadRequestException('Invalid file structure');
            }
        }));
        return { message: 'File uploaded successfully', data: result };
    }
};
__decorate([
    (0, common_1.Post)(':path'),
    (0, common_1.UseInterceptors)(file_interceptor_1.FileUploadInterceptor),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], FileUploadController.prototype, "upload", null);
exports.FileUploadController = FileUploadController = __decorate([
    (0, common_1.Controller)('upload'),
    __metadata("design:paramtypes", [file_upload_service_1.FileUploadService])
], FileUploadController);
