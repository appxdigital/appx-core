import {Injectable} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {S3Client, PutObjectCommand, S3ClientConfig} from '@aws-sdk/client-s3';
import {StorageService} from "../interfaces/storage-service.interface";

@Injectable()
export class AwsStorageService implements StorageService {
    private s3: S3Client;
    private readonly bucketName: string | undefined;


    constructor(private configService: ConfigService) {
        const s3Config = {
            region: this.configService.get<string>('AWS_REGION'),
        } as S3ClientConfig;

        const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
        const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');
        if (accessKeyId && secretAccessKey) {
            s3Config.credentials = {
                accessKeyId,
                secretAccessKey,
            };
        }

        this.s3 = new S3Client(s3Config);
        this.bucketName = this.configService.get<string>('AWS_BUCKET_NAME');
    }

    async uploadFile(file: Express.Multer.File): Promise<any> {
        if (!this.bucketName) {
            throw new Error('AWS_BUCKET_NAME is not defined.');
        }

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
        } catch (error) {
            console.error('AWS S3 upload error:', error);
            throw error;
        }
    }
}
