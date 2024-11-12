import {Controller, Post, UseInterceptors, Req, BadRequestException, ForbiddenException, ExecutionContext} from '@nestjs/common';
import { FileUploadInterceptor } from '../../common/interceptors/file.interceptor';
import { FileUploadService } from './file-upload.service';
import { Request as ExpressRequest } from 'express';

@Controller('upload')
export class FileUploadController {
    constructor(private fileUploadService: FileUploadService) {}

    @Post(':path')
    @UseInterceptors(FileUploadInterceptor)
    async upload(@Req() req: ExpressRequest) {
        const fileData = req.file || req.files;
        if (!fileData) {
            throw new BadRequestException('No file uploaded');
        }
        const files = Array.isArray(fileData) ? fileData : [fileData];
        const result = await Promise.all(
            files.map((file) => {
                if (file && file.originalname && file.buffer) {
                    return this.fileUploadService.uploadFile(file as Express.Multer.File);
                } else {
                    throw new BadRequestException('Invalid file structure');
                }
            })
        );

        return { message: 'File uploaded successfully', data: result };
    }
}
