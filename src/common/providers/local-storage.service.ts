import {Injectable, BadRequestException} from '@nestjs/common';
import {StorageService} from '../interfaces/storage-service.interface';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class LocalStorageService implements StorageService {
    private readonly uploadDir = path.join(process.cwd(), 'uploads');

    constructor() {
        if (!fs.existsSync(this.uploadDir)) {
            fs.mkdirSync(this.uploadDir, {recursive: true});
        }
    }

    async uploadFile(file: Express.Multer.File): Promise<any> {
        if (!file || !file.originalname || !file.buffer) {
            console.log('Invalid file data:', {
                hasOriginalName: !!file?.originalname,
                hasBuffer: !!file?.buffer,
            });
            throw new BadRequestException('Invalid file data');
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const uniqueName = `${timestamp}-${file.originalname}`;
        const filePath = path.join(this.uploadDir, uniqueName);

        await fs.promises.writeFile(filePath, file.buffer);
        return {
            filePath,
            originalName: file.originalname,
            size: file.size,
            mimeType: file.mimetype,
        };
    }
}
