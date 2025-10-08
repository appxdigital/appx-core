import {BadRequestException, ConflictException, ForbiddenException, HttpException, InternalServerErrorException, Logger, NotFoundException} from '@nestjs/common';
import {MulterError} from 'multer';

const logger = new Logger();

export function handleError(error: any): never {
    // If it's already an HttpException, just rethrow it
    if (error instanceof HttpException)
        throw error;

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
                throw new ForbiddenException('Foreign key constraint failed:', error.message);
            default:
                console.error(error);
                throw new InternalServerErrorException('A Prisma database error occurred.', error.message);
        }
    }

    logger.error(error);

    throw new InternalServerErrorException(error.message || 'An unknown error occurred.');
}
