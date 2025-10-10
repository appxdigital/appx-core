import {CallHandler, ExecutionContext, Injectable, NestInterceptor,} from '@nestjs/common';
import {CorePrismaContext, PrismaService} from '../../prisma/prisma.service';
import {Reflector} from '@nestjs/core';
import {ConfigService} from '@nestjs/config';
import {RequestContext} from 'nestjs-request-context';
import {catchError, tap} from 'rxjs/operators';
import {Observable, throwError} from 'rxjs';
import {PrismaClient} from '@prisma/client';
import {handleError} from "../utils/error-handler";
import {PERMISSION_METADATA_KEY} from "../decorators/permission.decorator";

@Injectable()
export class PrismaInterceptor implements NestInterceptor {
    private readonly defaultUseTransaction: string;

    constructor(
        private readonly prismaService: PrismaService,
        private reflector: Reflector,
        private configService: ConfigService,
    ) {
        this.defaultUseTransaction = this.configService.get<string>('USE_TRANSACTION', 'false');
    }

    intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
        const handlerType = context.getType<string>();
        const req =
            handlerType === 'graphql'
                ? context.getArgByIndex(2)  // GraphQL context
                : context.switchToHttp().getRequest();  // HTTP context

        // Attach expose_models metadata if needed
        const permissionMetadata = this.reflector.get(PERMISSION_METADATA_KEY, context.getHandler()) || {};

        return new Observable((observer) => {
            CorePrismaContext.run({
                exposedModels: permissionMetadata['expose_models'] || [],
            }, () => {
                const useTransaction = this.reflector.get<boolean>('useTransaction', context.getHandler()) ?? this.defaultUseTransaction === 'true';
                if (useTransaction) {
                    this.prismaService
                        .$transaction(async (transactionClient: PrismaClient) => {
                            RequestContext.currentContext.req.prisma = transactionClient;
                            await new Promise((resolve, reject) => {
                                next
                                    .handle()
                                    .pipe(
                                        tap(() => {}),
                                        catchError((err) => {
                                            const handledError = handleError(err);
                                            reject(handledError);
                                            return throwError(() => handledError);
                                        }),
                                    )
                                    .subscribe({
                                        next: (result) => observer.next(result),
                                        complete: () => {
                                            delete RequestContext.currentContext.req.prisma;
                                            observer.complete();
                                            resolve(null);
                                        },
                                        error: (err) => {
                                            delete RequestContext.currentContext.req.prisma;
                                            observer.error(err);
                                            reject(err);
                                        },
                                    });
                            });
                        })
                        .catch((err: Error) => {
                            delete RequestContext.currentContext.req.prisma;
                            observer.error(err);
                        });
                } else {
                    next.handle().pipe(
                        tap(() => {}),
                        catchError((error) => {
                            return throwError(() => handleError(error));
                        }),
                    ).subscribe({
                        next: (result) => observer.next(result),
                        complete: () => {
                            observer.complete();
                        },
                        error: (err) => {
                            observer.error(err);
                        }
                    });
                }
            });
        });
    }
}
