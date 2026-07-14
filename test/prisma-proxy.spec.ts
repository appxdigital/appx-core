/**
 * Prisma proxy / ABAC engine — behaviour tests against a real database.
 * Runs against whichever provider DB_PROVIDER selects (default: mysql).
 *
 * Each describe-block covers a distinct invariant of the access-control proxy.
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { buildTestModule, resetDb, asUser } from './helpers/test-module';
import { testPermissions } from './fixtures/permissions';

let prisma: PrismaService;
let rawClient: any;

beforeAll(async () => {
    const built = await buildTestModule(testPermissions);
    prisma = built.prisma;
    rawClient = built.rawClient;
});

afterAll(async () => {
    if (rawClient) await rawClient.$disconnect();
});

beforeEach(async () => {
    await resetDb(rawClient);
});

async function seed() {
    const tenantA = await rawClient.tenant.create({ data: { name: 'Tenant A' } });
    const tenantB = await rawClient.tenant.create({ data: { name: 'Tenant B' } });

    const alice = await rawClient.user.create({
        data: { email: 'alice@a.com', password: 'argon2-hash-A', role: 'USER', tenantId: tenantA.id },
    });
    const bob = await rawClient.user.create({
        data: { email: 'bob@a.com', password: 'argon2-hash-B', role: 'USER', tenantId: tenantA.id },
    });
    const root = await rawClient.user.create({
        data: { email: 'root@a.com', password: 'argon2-hash-R', role: 'ADMIN', tenantId: tenantA.id },
    });

    const tech = await rawClient.category.create({ data: { name: 'tech' } });

    await rawClient.post.create({ data: { title: 'Alice post 1', authorId: alice.id, categoryId: tech.id } });
    await rawClient.post.create({ data: { title: 'Alice post 2', authorId: alice.id } });
    await rawClient.post.create({ data: { title: 'Bob post 1',   authorId: bob.id,   categoryId: tech.id } });

    return { tenantA, tenantB, alice, bob, root, tech };
}

describe('blacklisted Prisma methods', () => {
    test('findUnique throws and suggests findFirst', async () => {
        await asUser({ id: 1, role: 'ADMIN' }, async () => {
            await expect((prisma.model as any).user.findUnique({ where: { id: 1 } }))
                .rejects.toThrow(/findUnique.*not.*allowed|findFirst/i);
        });
    });

    test('delete throws and suggests deleteMany', async () => {
        await asUser({ id: 1, role: 'ADMIN' }, async () => {
            await expect((prisma.model as any).user.delete({ where: { id: 1 } }))
                .rejects.toThrow(/delete.*not.*allowed|deleteMany/i);
        });
    });

    test('update throws and suggests updateMany', async () => {
        await asUser({ id: 1, role: 'ADMIN' }, async () => {
            await expect((prisma.model as any).user.update({ where: { id: 1 }, data: { email: 'x@x.com' } }))
                .rejects.toThrow(/update.*not.*allowed|updateMany/i);
        });
    });
});

describe('ABAC where-filtering on reads (USER_ID placeholder)', () => {
    test('USER findMany on Post only returns own posts', async () => {
        const { alice } = await seed();
        const posts = (await asUser({ id: alice.id, role: 'USER' }, () =>
            prisma.model.post.findMany({}),
        )) as any[];
        expect(posts).toHaveLength(2);
        expect(posts.every((p: any) => p.authorId === alice.id)).toBe(true);
    });

    test('ADMIN findMany on Post returns everyone\'s posts', async () => {
        await seed();
        const posts = (await asUser({ id: 999, role: 'ADMIN' }, () =>
            prisma.model.post.findMany({}),
        )) as any[];
        expect(posts.length).toBeGreaterThanOrEqual(3);
    });

    test('USER findMany on User only returns self', async () => {
        const { alice } = await seed();
        const users = (await asUser({ id: alice.id, role: 'USER' }, () =>
            prisma.model.user.findMany({}),
        )) as any[];
        expect(users).toHaveLength(1);
        expect(users[0].id).toBe(alice.id);
    });

    test('GUEST (no role) request on Post throws 403', async () => {
        await seed();
        await expect(
            asUser(null, () => prisma.model.post.findMany({})),
        ).rejects.toThrow(/permissions|Forbidden|403/i);
    });
});

describe('field-level omission (@Role(ADMIN) annotation on User.password)', () => {
    test('USER read of self does NOT include password', async () => {
        const { alice } = await seed();
        const u = await asUser({ id: alice.id, role: 'USER' }, () =>
            prisma.model.user.findFirst({ where: { id: alice.id } }),
        );
        expect(u).toBeTruthy();
        expect((u as any).password).toBeUndefined();
    });

    test('ADMIN read DOES include password', async () => {
        const { alice } = await seed();
        const u = await asUser({ id: 999, role: 'ADMIN' }, () =>
            prisma.model.user.findFirst({ where: { id: alice.id } }),
        );
        expect((u as any).password).toBe('argon2-hash-A');
    });
});

describe('BYPASS_FILTERING / BYPASS_OMISSION escape hatches', () => {
    test('BYPASS_FILTERING lets unauthenticated lookup-by-email work (auth use case)', async () => {
        const { alice } = await seed();
        const u = (await asUser(null, () =>
            (prisma.user as any).findFirst({ where: { email: alice.email } }, { BYPASS_FILTERING: true }),
        )) as any;
        expect(u).toBeTruthy();
        expect(u.id).toBe(alice.id);
    });

    test('BYPASS_OMISSION lets auth see password field even as USER role', async () => {
        const { alice } = await seed();
        const u = await asUser({ id: alice.id, role: 'USER' }, () =>
            (prisma.user as any).findFirst(
                { where: { id: alice.id } },
                { BYPASS_FILTERING: true, BYPASS_OMISSION: true },
            ),
        );
        expect((u as any).password).toBe('argon2-hash-A');
    });
});

describe('withExposedModels', () => {
    test('exposed model is treated as ALL during the callback', async () => {
        const { alice } = await seed();
        const users = (await asUser(
            { id: 999, role: 'USER' },                         // USER role normally can\'t read other users
            () => prisma.model.user.findMany({}),
            ['user'],                                          // expose User -> bypass filtering
        )) as any[];
        expect(users.length).toBeGreaterThanOrEqual(3);
        expect(users.find((u: any) => u.id === alice.id)).toBeTruthy();
    });
});

describe('conditions on create are enforced', () => {
    test('USER cannot create a Post attributed to ANOTHER user (condition { authorId: $USER_ID })', async () => {
        const { alice, bob } = await seed();
        // Acting as alice, set authorId=bob. The create condition requires
        // authorId === $USER_ID, so the proxy must reject this before insert.
        await expect(
            asUser({ id: alice.id, role: 'USER' }, () =>
                prisma.model.post.create({ data: { title: 'forged', authorId: bob.id } }),
            ),
        ).rejects.toThrow(/not allowed to create/i);

        const forged = await asUser({ id: alice.id, role: 'ADMIN' }, () =>
            prisma.model.post.findMany({ where: { title: 'forged' } }),
        );
        expect(forged.length).toBe(0);   // nothing was inserted
    });

    test('USER can create a Post attributed to themselves', async () => {
        const { alice } = await seed();
        const post = (await asUser({ id: alice.id, role: 'USER' }, () =>
            prisma.model.post.create({ data: { title: 'mine', authorId: alice.id } }),
        )) as any;
        expect(post.authorId).toBe(alice.id);
    });
});

describe('count fallback to read permission', () => {
    test('count on Post for USER honours the findMany conditions', async () => {
        const { alice } = await seed();
        const n = await asUser({ id: alice.id, role: 'USER' }, () =>
            (prisma.model.post as any).count(),
        );
        expect(n).toBe(2);
    });
});
