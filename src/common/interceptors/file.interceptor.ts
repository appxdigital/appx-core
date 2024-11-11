import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    BadRequestException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { FileUploadService } from '../../modules/file/file-upload.service';
import multer from 'multer';

@Injectable()
export class FileUploadInterceptor implements NestInterceptor {
    constructor(private fileUploadService: FileUploadService) {}

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const req = context.switchToHttp().getRequest();
        const endpoint = req.originalUrl || req.url;
        const config = this.fileUploadService.getEndpointConfig(endpoint);

        if (!config) {
            throw new BadRequestException('Endpoint not configured');
        }

        const multerOptions: multer.Options = {
            storage: multer.memoryStorage(),
            limits: { fileSize: config.maxSize },
            fileFilter: (req, file, cb) => {
                if (config.allowedTypes.includes(file.mimetype)) {
                    cb(null, true);
                } else {
                    cb(new BadRequestException('Invalid file type'));
                }
            },
        };
        const upload = multer(multerOptions)[config.multiple ? 'array' : 'single']('file');

        return new Promise((resolve, reject) => {
            upload(req, req.res, (err: any) => {
                if (err) {
                    console.log('Multer upload error:', err);
                    return reject(err);
                }
                resolve(next.handle());
            });
        }) as any;
    }
}
