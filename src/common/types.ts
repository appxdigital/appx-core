import {PrismaClient} from '@prisma/client';
import 'express-session';

export type Type<T> = new (...args: any[]) => T;

declare global {
    namespace Express {
        interface Request {
            prisma?: PrismaClient;

            login(user: any, done: (err: any) => void): void;

            logout(callback: (err: any) => void): void;

            user?: User | undefined;
        }

        interface User extends Record<string, any> {
        }
    }
}

declare module 'express-session' {
    interface SessionData {
        // string | number so string-keyed (uuid/cuid) User ids fit. This is a
        // global augmentation shipped by the package, so a narrower `number`
        // would land in every consumer's type space and block string-id adopters.
        userId: string | number;
    }
}
