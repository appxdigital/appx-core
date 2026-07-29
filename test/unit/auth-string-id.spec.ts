/**
 * Regression tests for string (uuid/cuid) `User.id` support in the auth module.
 *
 * These construct the real classes with a fake PrismaService whose `user`
 * delegate reports a `String` primary key, and assert the id reaches Prisma
 * verbatim — not `Number(uuid)` → NaN (SessionSerializer) or
 * `parseInt(uuid)` → 3 (getSessionsByUserId). No database; pure logic.
 */
import 'reflect-metadata';
import { SessionSerializer } from '../../src/modules/auth/session/session-serializer';
import { AuthService } from '../../src/modules/auth/auth.service';

const UUID = '3f2a1c9e-2b7d-4a6f-9c11-8e5b2d0a7f42';

/** Fake PrismaService: a `String`-keyed user model + spied session/token ops. */
function fakePrisma(idTypeName: 'String' | 'Int', userRow: any = { id: UUID, role: 'USER' }) {
    return {
        user: {
            fields: { id: { typeName: idTypeName } },
            findFirstOrThrow: jest.fn().mockResolvedValue(userRow),
        },
        session: { findMany: jest.fn().mockResolvedValue([]) },
        userRefreshToken: { updateMany: jest.fn().mockResolvedValue({}) },
    };
}

describe('SessionSerializer with a String User.id', () => {
    it('deserializeUser looks the user up by the raw uuid (not NaN)', async () => {
        const prisma = fakePrisma('String');
        const serializer = new SessionSerializer(prisma as any);

        const user = await new Promise((resolve, reject) =>
            serializer.deserializeUser(UUID, (err: any, u: any) => (err ? reject(err) : resolve(u))),
        );

        expect(prisma.user.findFirstOrThrow).toHaveBeenCalledTimes(1);
        const arg = prisma.user.findFirstOrThrow.mock.calls[0][0];
        expect(arg.where).toEqual({ id: UUID });      // the bug produced { id: NaN }
        expect(user).toEqual({ id: UUID, role: 'USER' });
    });

    it('serialize → deserialize round-trips the user id', async () => {
        const prisma = fakePrisma('String');
        const serializer = new SessionSerializer(prisma as any);

        const serialized = await new Promise<string>((resolve) =>
            serializer.serializeUser({ id: UUID, role: 'USER' }, (_e: any, v: any) => resolve(v)),
        );
        expect(serialized).toBe(UUID);

        const back: any = await new Promise((resolve, reject) =>
            serializer.deserializeUser(serialized, (err: any, u: any) => (err ? reject(err) : resolve(u))),
        );
        expect(back.id).toBe(UUID);
    });

    it('still coerces to a number for an Int User.id (no regression)', async () => {
        const prisma = fakePrisma('Int', { id: 5, role: 'USER' });
        const serializer = new SessionSerializer(prisma as any);

        await new Promise((resolve, reject) =>
            serializer.deserializeUser('5', (err: any, u: any) => (err ? reject(err) : resolve(u))),
        );
        expect(prisma.user.findFirstOrThrow.mock.calls[0][0].where).toEqual({ id: 5 });
    });
});

describe('AuthService session/token lookups with a String User.id', () => {
    function makeService(prisma: any) {
        const configService = { get: (_k: string, d?: any) => d ?? 'cookie' };
        return new AuthService({} as any, prisma as any, {} as any, configService as any);
    }

    it('getSessionsByUserId queries by the raw uuid (parseInt would give 3)', async () => {
        const prisma = fakePrisma('String');
        const service = makeService(prisma);

        await service.getSessionsByUserId(UUID);

        const where = prisma.session.findMany.mock.calls[0][0].where;
        expect(where.userId).toBe(UUID);
    });

    it('revokeRefreshTokensForUser scopes the update to the raw uuid', async () => {
        const prisma = fakePrisma('String');
        const service = makeService(prisma);

        await service.revokeRefreshTokensForUser(UUID);

        const where = prisma.userRefreshToken.updateMany.mock.calls[0][0].where;
        expect(where.userId).toBe(UUID);
    });

    it('getSessionsByUserId still coerces to a number for an Int User.id', async () => {
        const prisma = fakePrisma('Int');
        const service = makeService(prisma);

        await service.getSessionsByUserId('5');

        expect(prisma.session.findMany.mock.calls[0][0].where.userId).toBe(5);
    });
});
