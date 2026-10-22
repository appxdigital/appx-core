// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var FileUploadModule_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FileUploadModule = void 0;
const common_1 = require("@nestjs/common");
const file_upload_service_1 = require("./file-upload.service");
const file_upload_controller_1 = require("./file-upload.controller");
const aws_storage_service_1 = require("../../common/providers/aws-storage.service");
const local_storage_service_1 = require("../../common/providers/local-storage.service");
const contants_1 = require("../../common/contants");
const gcp_storage_service_1 = require("../../common/providers/gcp-storage.service");
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
let FileUploadModule = exports.FileUploadModule = FileUploadModule_1 = class FileUploadModule {
    static register(options) {
        const providers = [
            file_upload_service_1.FileUploadService,
            {
                provide: contants_1.FILE_UPLOAD_OPTIONS,
                useValue: options,
            },
        ];
        let storageProvider;
        switch (options.cloudProvider) {
            case 'aws':
                storageProvider = {
                    provide: contants_1.STORAGE_SERVICE,
                    useClass: aws_storage_service_1.AwsStorageService,
                };
                break;
            case 'gcp':
                storageProvider = {
                    provide: contants_1.STORAGE_SERVICE,
                    useClass: gcp_storage_service_1.GcpStorageService,
                };
                break;
            case 'local':
                storageProvider = {
                    provide: contants_1.STORAGE_SERVICE,
                    useClass: local_storage_service_1.LocalStorageService,
                };
                break;
            default:
                throw new Error('Unsupported cloud provider');
        }
        providers.push(storageProvider);
        return {
            module: FileUploadModule_1,
            controllers: [file_upload_controller_1.FileUploadController],
            providers: providers,
            exports: [file_upload_service_1.FileUploadService, contants_1.FILE_UPLOAD_OPTIONS, contants_1.STORAGE_SERVICE],
        };
    }
};
exports.FileUploadModule = FileUploadModule = FileUploadModule_1 = __decorate([
    (0, common_1.Module)({})
], FileUploadModule);
