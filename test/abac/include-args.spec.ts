/**
 * An included relation keeps its arguments (`where`, `orderBy`, `take`, …) when
 * field omission rewrites `include` to `select`; they are checked and scoped
 * like the same arguments under `select`.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';

describe('include relation arguments', () => {
    let raw: any;
    let s: SeededAbac;

    beforeAll(async () => {
        raw = newRawClient();
        await raw.$connect();
        await resetAbac(raw);
        s = await seedAbac(raw);
    });

    afterAll(async () => {
        await resetAbac(raw);
        await raw.$disconnect();
    });

    const reports = (prisma: any, args: any) =>
        asUser(s.users.alice, () => prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { reports: args } }))
            .then((me: any) => me.reports.map((r: any) => r.id));

    test('where, orderBy and take apply to the included relation', async () => {
        await withConfig({}, async (prisma) => {
            expect(await reports(prisma, { where: { id: s.users.bob.id } })).toEqual([s.users.bob.id]);
            expect(await reports(prisma, { orderBy: { id: 'desc' }, take: 1 })).toEqual([s.users.carol.id]);
        });
    });

    test('the read rule still applies, and so does nested select/include omission', async () => {
        await withConfig({}, async (prisma) => {
            expect(await reports(prisma, { where: { id: { in: [s.users.bob.id, s.users.dave.id] } } })).toEqual([s.users.bob.id]);
            const me: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { reports: { where: { id: s.users.bob.id }, include: { tenant: true } } } }),
            );
            expect(me.reports).toHaveLength(1);
            expect(me.reports[0]).not.toHaveProperty('password');
            expect(me.reports[0].tenant.id).toBe(s.users.bob.tenantId);
        });
    });

    test('a nested where on a column outside the role list is rejected (403)', async () => {
        await withConfig({}, async (prisma) => {
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { ownedProjects: { where: { secretApiKey: 'sk-A' } } } }),
                ),
            ).rejects.toMatchObject({ status: 403 });
        });
    });
});
