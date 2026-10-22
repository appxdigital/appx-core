// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GcpStorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const path = __importStar(require("path"));
let GcpStorageService = exports.GcpStorageService = class GcpStorageService {
    constructor(configService) {
        this.configService = configService;
        const keyFilePath = this.configService.get('GCP_KEY_FILE_PATH');
        const projectId = this.configService.get('GCP_PROJECT_ID');
        this.bucketName = this.configService.get('GCP_BUCKET_NAME') || '';
        if (!keyFilePath || !projectId || !this.bucketName) {
            throw new Error('Missing GCP configuration values.');
        }
        // Lazy require: @google-cloud/storage is installed by the project, only for the gcp provider.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Storage } = require('@google-cloud/storage');
        this.storage = new Storage({
            projectId,
            keyFilename: path.resolve(keyFilePath),
        });
    }
    async uploadFile(file) {
        const bucket = this.storage.bucket(this.bucketName);
        const blob = bucket.file(file.originalname);
        const blobStream = blob.createWriteStream();
        return new Promise((resolve, reject) => {
            blobStream.on('error', (error) => reject(error));
            blobStream.on('finish', () => {
                resolve({
                    fileUrl: `https://storage.googleapis.com/${this.bucketName}/${blob.name}`,
                });
            });
            blobStream.end(file.buffer);
        });
    }
};
exports.GcpStorageService = GcpStorageService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(config_1.ConfigService)),
    __metadata("design:paramtypes", [config_1.ConfigService])
], GcpStorageService);
