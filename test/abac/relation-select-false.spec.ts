/**
 * A relation selected as `false` is not read, so it is not filtered either.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';

describe('relation selected as false', () => {
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

    test('to-many and to-one relations selected as false are left out', async () => {
        await withConfig({}, async (prisma) => {
            const me: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({ where: { id: s.users.alice.id }, select: { id: true, reports: false, tenant: false } }),
            );
            expect(me).toEqual({ id: s.users.alice.id });
        });
    });
});
