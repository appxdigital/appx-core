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
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileUploadInterceptor = void 0;
const common_1 = require("@nestjs/common");
const file_upload_service_1 = require("../../modules/file/file-upload.service");
const nestjs_request_context_1 = require("nestjs-request-context");
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
let FileUploadInterceptor = exports.FileUploadInterceptor = class FileUploadInterceptor {
    constructor(fileUploadService) {
        this.fileUploadService = fileUploadService;
    }
    async intercept(context, next) {
        const req = context.switchToHttp().getRequest();
        const endpoint = req.url;
        const config = this.fileUploadService.getEndpointConfig(endpoint);
        if (!config) {
            throw new common_1.BadRequestException('Endpoint not configured');
        }
        const userRole = req.user?.role;
        if (!config.roles.includes('ALL')) {
            if (!userRole) {
                throw new common_1.ForbiddenException('User role is required for this upload endpoint');
            }
            this.fileUploadService.validateUserRole(endpoint, userRole);
        }
        // Lazy require: multer is installed by the project, only when file upload is used.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const multer = require('multer');
        const multerOptions = {
            storage: multer.memoryStorage(),
            limits: { fileSize: config.maxSize },
            fileFilter: (req, file, cb) => {
                const normalizedMimeType = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
                if (config.allowedTypes.includes(normalizedMimeType)) {
                    cb(null, true);
                }
                else {
                    cb(new common_1.BadRequestException('Invalid file type'));
                }
            },
        };
        const upload = multer(multerOptions)[config.multiple ? 'array' : 'single']('file');
        const store = nestjs_request_context_1.RequestContext.cls.getStore();
        if (!store) {
            throw new Error('RequestContext store is undefined. Ensure that RequestContextMiddleware is applied.');
        }
        await new Promise((resolve, reject) => {
            nestjs_request_context_1.RequestContext.cls.run(store, () => {
                upload(req, req.res, (err) => {
                    if (err) {
                        console.log('Multer upload error:', err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        });
        return next.handle();
    }
};
exports.FileUploadInterceptor = FileUploadInterceptor = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [file_upload_service_1.FileUploadService])
], FileUploadInterceptor);
