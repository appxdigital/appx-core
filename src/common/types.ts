import {PrismaClient} from '@prisma/client';
import 'express-session';

export type Type<T> = new (...args: any[]) => T;

declare global {
    namespace Express {
        interface Request {
            prisma?: PrismaClient;

            login(user: any, done: (err: any) => void): void;

            logout(callback: (err: any) => void): void;

            user?: any;
        }

        interface User extends Record<string, any> {
        }
    }
}

declare module 'express-session' {
    interface SessionData {
        userId: number;
    }
}
