import { Controller, Post, UseInterceptors, Request, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileUploadInterceptor } from '../../common/interceptors/file.interceptor';
import { FileUploadService } from './file-upload.service';
import { Request as ExpressRequest } from 'express';

@Controller('upload')
export class FileUploadController {
    constructor(private fileUploadService: FileUploadService) {}

    @Post(':path')
    @UseInterceptors(FileUploadInterceptor)
    async upload(@Request() req: ExpressRequest) {
        const fileData = req.file || req.files;
        if (!fileData) {
            throw new BadRequestException('No file uploaded');
        }

        const userRole = req.user?.role;
        const endpointSuffix = `/upload/${req.params.path}`;

        const config = this.fileUploadService.getEndpointConfig(endpointSuffix);
        if (!config) {
            throw new BadRequestException(`Endpoint not configured for path: ${endpointSuffix}`);
        }

        if (!config.roles.includes('ALL')) {
            if (!userRole) {
                throw new ForbiddenException('User role is required for this upload endpoint');
            }
            this.fileUploadService.validateUserRole(endpointSuffix, userRole);
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
