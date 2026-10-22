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
exports.AwsStorageService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
/** @deprecated File upload is kept for existing projects only (docs/storage.md). */
let AwsStorageService = exports.AwsStorageService = class AwsStorageService {
    constructor(configService) {
        this.configService = configService;
        const s3Config = {
            region: this.configService.get('AWS_REGION'),
        };
        const accessKeyId = this.configService.get('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get('AWS_SECRET_ACCESS_KEY');
        if (accessKeyId && secretAccessKey) {
            s3Config.credentials = {
                accessKeyId,
                secretAccessKey,
            };
        }
        // Lazy require: @aws-sdk/client-s3 is installed by the project, only for the aws provider.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { S3Client } = require('@aws-sdk/client-s3');
        this.s3 = new S3Client(s3Config);
        this.bucketName = this.configService.get('AWS_BUCKET_NAME');
    }
    async uploadFile(file) {
        if (!this.bucketName) {
            throw new Error('AWS_BUCKET_NAME is not defined.');
        }
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { PutObjectCommand } = require('@aws-sdk/client-s3');
        const command = new PutObjectCommand({
            Bucket: this.bucketName,
            Key: file.originalname,
            Body: file.buffer,
        });
        try {
            const response = await this.s3.send(command);
            return {
                key: file.originalname,
                location: `https://${this.bucketName}.s3.amazonaws.com/${file.originalname}`,
                ...response,
            };
        }
        catch (error) {
            console.error('AWS S3 upload error:', error);
            throw error;
        }
    }
};
exports.AwsStorageService = AwsStorageService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AwsStorageService);
