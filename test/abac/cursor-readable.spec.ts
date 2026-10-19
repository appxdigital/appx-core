/**
 * A `cursor` matches a row by value, so a cursor that names a column the role
 * can't read (`@Role`) or a `fields` column is rejected (403), like `orderBy`.
 * `Project.secretApiKey` is `@Role(ADMIN)`.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';

const $UID = '$USER_ID';

describe('cursor on unreadable columns', () => {
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

    const ownEmail = { User: { USER: { fields: { email: { visibleOnlyWhen: { id: $UID } } } } } };

    test('a cursor on a column outside the role list is rejected', async () => {
        await withConfig({}, async (prisma) => {
            await expect(
                asUser(s.users.alice, () => prisma.model.project.findMany({ cursor: { id: s.projects.p1.id, secretApiKey: 'sk-A' } })),
            ).rejects.toMatchObject({ status: 403 });
        });
    });

    test('a cursor on a fields column is rejected, also inside AND / OR / NOT', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const find = (cursor: any) => asUser(s.users.alice, () => prisma.model.user.findMany({ cursor, select: { id: true } }));
            await expect(find({ email: 'bob@t.io' })).rejects.toMatchObject({ status: 403 });
            await expect(find({ id: s.users.bob.id, AND: [{ email: { startsWith: 'b' } }] })).rejects.toMatchObject({ status: 403 });
        });
    });

    test('a compound unique cursor is checked column by column', async () => {
        await withConfig({ ProjectMember: { USER: { fields: { userId: { visibleOnlyWhen: { role: 'manager' } } } } } }, async (prisma) => {
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.projectMember.findMany({ cursor: { projectId_userId: { projectId: s.projects.p1.id, userId: s.users.alice.id } } }),
                ),
            ).rejects.toMatchObject({ status: 403 });
        });
    });

    test('a cursor in a nested selection is checked', async () => {
        await withConfig(ownEmail, async (prisma) => {
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.user.findFirst({ where: { id: s.users.alice.id }, select: { reports: { cursor: { email: 'bob@t.io' }, select: { id: true } } } }),
                ),
            ).rejects.toMatchObject({ status: 403 });
        });
    });

    test('cursors on readable columns, exposed models and roles on the list work as before', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const byId: any[] = await asUser(s.users.alice, () =>
                prisma.model.user.findMany({ cursor: { id: s.users.bob.id }, orderBy: { id: 'asc' }, select: { id: true } }),
            );
            expect(byId.map((r) => r.id)).toEqual([s.users.bob.id, s.users.carol.id]);

            const exposed: any[] = await asUser(s.users.alice, () => prisma.model.user.findMany({ cursor: { email: 'bob@t.io' }, select: { id: true } }), ['User']);
            expect(exposed.map((r) => r.id)).toContain(s.users.bob.id);

            const admin: any[] = await asUser(s.users.root, () =>
                prisma.model.project.findMany({ cursor: { id: s.projects.p1.id, secretApiKey: 'sk-A' }, select: { id: true } }),
            );
            expect(admin.map((r) => r.id)).toContain(s.projects.p1.id);
        });
    });
});
