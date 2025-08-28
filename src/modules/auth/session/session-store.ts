import {Store} from 'express-session';
import {PrismaClient} from '@prisma/client';
import {PrismaClientKnownRequestError} from '@prisma/client/runtime/library';
import {PrismaService} from '../../../prisma/prisma.service';
import {createId} from '@paralleldrive/cuid2';

export type Options = {
    ttl: number;
}

export class CorePrismaSessionStore extends Store {
    private prisma: PrismaClient;
    private options: Options;

    constructor(prismaService: PrismaService, options?: Options) {
        super();

        // Merge default options with provided options
        const defaultOptions: Options = {
            ttl: 3600 * 24, // Default to 1 day
        };
        this.options = {...defaultOptions, ...(options || {})};

        this.prisma = prismaService.prismaClient;
    }

    public get = async (
        sid: string,
        callback: (err: any, session?: any | null) => void,
    ) => {
        try {
            const record = await this.prisma.session.findFirst({where: {sid}}, {BYPASS_FILTERING: true});
            if (!record) {
                return callback(null, null);
            }
            if (record.expiresAt && record.expiresAt <= new Date()) {
                await this.prisma.session.deleteMany({where: {sid}}, {BYPASS_FILTERING: true});
                return callback(null, null);
            }
            const session = JSON.parse(record.data);
            return callback(null, session);
        } catch (err) {
            return callback(err);
        }
    };

    public set = async (
        sid: string,
        session: any,
        callback?: (err?: any) => void,
    ) => {
        try {
            let userId = null;
            if (session.passport && session.passport.user) {
                userId = session.passport.user;
            }
            const data = JSON.stringify(session);
            const expiresAt =
                session.cookie && session.cookie.expires
                    ? new Date(session.cookie.expires)
                    : new Date(Date.now() + this.options.ttl * 1000);

            await this.prisma.session.upsert({
                where: {sid},
                create: {
                    id: createId(),
                    sid,
                    data,
                    expiresAt,
                    userId,
                },
                update: {
                    data,
                    expiresAt,
                    userId,
                },
            }, {
                BYPASS_FILTERING: true
            });
            callback?.();
        } catch (err) {
            console.error('Error while setting session:', err);
            callback?.(err);
        }
    };

    public destroy = async (sid: string, callback?: (err?: any) => void) => {
        try {
            await this.prisma.session.deleteMany({where: {sid}}, {BYPASS_FILTERING: true});
            callback?.();
        } catch (err) {
            if (
                err instanceof PrismaClientKnownRequestError &&
                err.code === 'P2025'
            ) {
                callback?.();
            } else {
                callback?.(new Error('Failed to destroy session.'));
            }
        }
    };

    public touch = async (
        sid: string,
        session: any,
        callback?: (err?: any) => void,
    ) => {
        try {
            let expiresAt = null;
            if (session.cookie && session.cookie.maxAge) {
                expiresAt = new Date(Date.now() + session.cookie.maxAge);
            } else {
                expiresAt = new Date(Date.now() + this.options.ttl * 1000);
            }
            await this.prisma.session.updateMany({
                where: {sid},
                data: {expiresAt},
            }, {BYPASS_FILTERING: true});
            if (callback) callback();
        } catch (err) {
            if (callback) callback(err);
        }
    };
}
