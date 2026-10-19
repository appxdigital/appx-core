/**
 * The row a `create` returns follows field omission: columns whose `/// @Role`
 * list doesn't include the caller's role are not returned, as on reads.
 * `Project.secretApiKey` is `@Role(ADMIN)`; `User.password` is `@Role(none)`.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';

describe('create result — field omission', () => {
    let raw: any;
    let s: SeededAbac;

    beforeAll(async () => {
        raw = newRawClient();
        await raw.$connect();
        await resetAbac(raw);
        s = await seedAbac(raw);
    });

    afterEach(async () => {
        await raw.project.deleteMany({ where: { name: { startsWith: 'CR-' } } });
    });

    afterAll(async () => {
        await resetAbac(raw);
        await raw.$disconnect();
    });

    const create = (prisma: any, user: any, args: any, options?: any) =>
        asUser(user, () => (prisma.model.project.create as any)(args, options));

    test('a column outside the role list is not returned; the value is stored', async () => {
        await withConfig({ Project: { USER: { create: 'ALL' } } }, async (prisma) => {
            const row: any = await create(prisma, s.users.bob, { data: { name: 'CR-user', ownerId: s.users.bob.id, secretApiKey: 'sk-cr' } });
            expect(row.name).toBe('CR-user');
            expect(row).not.toHaveProperty('secretApiKey');
            expect((await raw.project.findFirst({ where: { name: 'CR-user' } })).secretApiKey).toBe('sk-cr');
        });
    });

    test('an explicit select of such a column is stripped', async () => {
        await withConfig({ Project: { USER: { create: 'ALL' } } }, async (prisma) => {
            const row: any = await create(prisma, s.users.bob, {
                data: { name: 'CR-select', ownerId: s.users.bob.id, secretApiKey: 'sk-cr' },
                select: { id: true, secretApiKey: true },
            });
            expect(row.id).toBeDefined();
            expect(row).not.toHaveProperty('secretApiKey');
        });
    });

    test('nested relations in the result follow omission too', async () => {
        await withConfig({ Project: { USER: { create: 'ALL' } } }, async (prisma) => {
            const row: any = await create(prisma, s.users.bob, {
                data: { name: 'CR-include', ownerId: s.users.bob.id },
                include: { owner: true },
            });
            expect(row.owner.id).toBe(s.users.bob.id);
            expect(row.owner).not.toHaveProperty('password');
        });
    });

    test('a role on the list gets the column', async () => {
        await withConfig({}, async (prisma) => {
            const row: any = await create(prisma, s.users.root, { data: { name: 'CR-admin', ownerId: s.users.root.id, secretApiKey: 'sk-cr' } });
            expect(row.secretApiKey).toBe('sk-cr');
        });
    });

    test('BYPASS_OMISSION returns every column', async () => {
        await withConfig({ Project: { USER: { create: 'ALL' } } }, async (prisma) => {
            const row: any = await create(
                prisma,
                s.users.bob,
                { data: { name: 'CR-bypass', ownerId: s.users.bob.id, secretApiKey: 'sk-cr' } },
                { BYPASS_OMISSION: true },
            );
            expect(row.secretApiKey).toBe('sk-cr');
        });
    });
});
