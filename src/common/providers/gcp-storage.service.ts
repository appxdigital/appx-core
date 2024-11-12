import { Injectable, Inject } from '@nestjs/common';
import { Storage } from '@google-cloud/storage';
import { StorageService } from '../interfaces/storage-service.interface';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';

@Injectable()
export class GcpStorageService implements StorageService {
    private storage: Storage;
    private readonly bucketName: string;

    constructor(@Inject(ConfigService) private configService: ConfigService) {
        const keyFilePath = this.configService.get<string>('GCP_KEY_FILE_PATH');
        const projectId = this.configService.get<string>('GCP_PROJECT_ID');
        this.bucketName = this.configService.get<string>('GCP_BUCKET_NAME') || '';

        if (!keyFilePath || !projectId || !this.bucketName) {
            throw new Error('Missing GCP configuration values.');
        }

        this.storage = new Storage({
            projectId,
            keyFilename: path.resolve(keyFilePath),
        });
    }

    async uploadFile(file: Express.Multer.File): Promise<any> {
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
}
