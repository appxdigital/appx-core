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
                    // Run the handler inside the transaction and CAPTURE its result,
                    // but do not emit the response yet: the client must not see a
                    // success response until the transaction has actually committed.
                    // Emitting inside the transaction (before it commits) races the
                    // commit — an immediate read-after-write can miss the row.
                    let handlerResult: any;
                    this.prismaService
                        .$transaction(async (transactionClient: PrismaClient) => {
                            RequestContext.currentContext.req.prisma = transactionClient;
                            handlerResult = await new Promise((resolve, reject) => {
                                let captured: any;
                                next
                                    .handle()
                                    .pipe(
                                        catchError((err) => {
                                            const handledError = handleError(err);
                                            reject(handledError);
                                            return throwError(() => handledError);
                                        }),
                                    )
                                    .subscribe({
                                        next: (result) => {
                                            captured = result;
                                        },
                                        complete: () => {
                                            delete RequestContext.currentContext.req.prisma;
                                            resolve(captured);
                                        },
                                        error: (err) => {
                                            delete RequestContext.currentContext.req.prisma;
                                            reject(err);
                                        },
                                    });
                            });
                        })
                        .then(() => {
                            // The transaction has committed — now it is safe to respond.
                            observer.next(handlerResult);
                            observer.complete();
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
