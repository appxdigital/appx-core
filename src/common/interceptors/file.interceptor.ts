import {
    Injectable,
    NestInterceptor,
    ExecutionContext,
    CallHandler,
    BadRequestException,
    ForbiddenException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { FileUploadService } from '../../modules/file/file-upload.service';
import multer from 'multer';
import { RequestContext } from 'nestjs-request-context';

@Injectable()
export class FileUploadInterceptor implements NestInterceptor {
    constructor(private fileUploadService: FileUploadService) {}

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        const req = context.switchToHttp().getRequest();
        const endpoint = req.url;
        const config = this.fileUploadService.getEndpointConfig(endpoint);
        if (!config) {
            throw new BadRequestException('Endpoint not configured');
        }
        const userRole = req.user?.role;

        if (!config.roles.includes('ALL')) {
            if (!userRole) {
                throw new ForbiddenException('User role is required for this upload endpoint');
            }
            this.fileUploadService.validateUserRole(endpoint, userRole);
        }

        const multerOptions: multer.Options = {
            storage: multer.memoryStorage(),
            limits: { fileSize: config.maxSize },
            fileFilter: (req, file, cb) => {
                const normalizedMimeType =
                    file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
                if (config.allowedTypes.includes(normalizedMimeType)) {
                    cb(null, true);
                } else {
                    cb(new BadRequestException('Invalid file type'));
                }
            },
        };

        const upload = multer(multerOptions)[config.multiple ? 'array' : 'single']('file');
        const store = RequestContext.cls.getStore();

        if (!store) {
            throw new Error('RequestContext store is undefined. Ensure that RequestContextMiddleware is applied.');
        }
        await new Promise<void>((resolve, reject) => {
            RequestContext.cls.run(store, () => {
                upload(req, req.res, (err: any) => {
                    if (err) {
                        console.log('Multer upload error:', err);
                        return reject(err);
                    }
                    resolve();
                });
            });
        });

        return next.handle();
    }
}
