import {BadRequestException, ConflictException, ForbiddenException, NotFoundException, InternalServerErrorException, HttpException} from '@nestjs/common';
import {MulterError} from 'multer';

export function handleError(error: any): never {

    if (error instanceof HttpException) {
        throw error;
    }
    console.error('Error:', error);

    // Multer errors
    if (error instanceof MulterError) {
        switch (error.code) {
            case 'LIMIT_FILE_SIZE':
                throw new BadRequestException('Uploaded file exceeds the maximum allowed size.');
            case 'LIMIT_FILE_COUNT':
                throw new BadRequestException('Too many files uploaded.');
            case 'LIMIT_UNEXPECTED_FILE':
                throw new BadRequestException('Unexpected file field name.');
            default:
                throw new BadRequestException(`File upload error: ${error.message}`);
        }
    }

    // Prisma errors
    if (error && typeof error === 'object' && 'code' in error) {
        switch (error.code) {
            case 'P2002':
                throw new ConflictException('Duplicate entry detected.');
            case 'P2025':
                throw new NotFoundException('The requested record was not found.');
            case 'P2003':
                throw new ForbiddenException('You are not authorized to perform this action.');
            default:
                throw new BadRequestException('A Prisma database error occurred.');
        }
    }

    throw new InternalServerErrorException(error.message || 'An unknown error occurred.');
}
