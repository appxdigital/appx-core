import {Injectable} from '@nestjs/common';
import {PassportSerializer} from '@nestjs/passport';
import {PrismaService} from '../../../prisma/prisma.service';
import {coerceId} from '../../../common/utils/coerce-id.util';

@Injectable()
export class SessionSerializer extends PassportSerializer {
    constructor(private prisma: PrismaService) {
        super();
    }

    serializeUser(user: any, done: Function) {
        done(null, user.id);
    }

    async deserializeUser(userId: string, done: Function) {
        if (!userId) {
            return done(new Error('No userId provided'), null);
        }
        try {
            const user = await this.prisma.user.findFirstOrThrow({
                // Coerce to the User PK's actual type. `Number(userId)` here made
                // session auth fail closed for string (uuid/cuid) ids — Number of
                // a uuid is NaN, so findFirstOrThrow threw on every request.
                where: {id: coerceId(this.prisma.user as any, userId)},
                select: {
                    id: true,
                    role: true,
                },
            }, {
                BYPASS_FILTERING: true,
                BYPASS_OMISSION: true,
            });
            done(null, user);
        } catch (error) {
            console.debug('Error deserializing user:', error);
            done(new Error('User not found'), null);
        }
    }
}
