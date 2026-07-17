/**
 * Runtime counterpart to the proxied-delegate type contract: the proxy
 * transparently redirects the single-record methods to their filter-compatible
 * equivalents, applying ABAC conditions along the way.
 *   - update()  → updateMany  (returns a count; conditions applied)
 *   - delete()  → deleteMany  (conditions applied)
 *   - findUnique() → findFirst (conditions applied)
 * Also exercises the singular `update` / `delete` permission keys being
 * inherited by their `*Many` action.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;

describe('proxy method redirect (update / delete / findUnique)', () => {
    let raw: any;
    let s: SeededAbac;

    beforeAll(async () => {
        raw = newRawClient();
        await raw.$connect();
    });
    afterAll(async () => {
        await resetAbac(raw);
        await raw.$disconnect();
    });
    beforeEach(async () => {
        await resetAbac(raw);
        s = await seedAbac(raw);
    });

    test('update() runs as updateMany: returns a count and applies conditions (singular `update` key)', async () => {
        await withConfig(
            { Project: { USER: { update: { conditions: { ownerId: $UID } } } } },
            async (prisma) => {
                const res: any = await asUser(s.users.alice, () =>
                    prisma.model.project.update({ where: {}, data: { status: 'archived' } }),
                );
                expect(res).toEqual({ count: 2 }); // alice owns p1 + p2 only
            },
        );
        // Other owners' projects untouched — the where-conditions scoped the write.
        const p3 = await raw.project.findUnique({ where: { id: s.projects.p3.id } });
        const p4 = await raw.project.findUnique({ where: { id: s.projects.p4.id } });
        expect(p3.status).toBe('draft');
        expect(p4.status).toBe('active');
    });

    test('delete() runs as deleteMany: conditions prevent a cross-owner delete (singular `delete` key)', async () => {
        await withConfig(
            { Project: { USER: { delete: { conditions: { ownerId: $UID } } } } },
            async (prisma) => {
                const res: any = await asUser(s.users.dave, () =>
                    prisma.model.project.delete({ where: { id: s.projects.p1.id } }),
                );
                expect(res).toEqual({ count: 0 }); // dave doesn't own p1 → nothing deleted
            },
        );
        const p1 = await raw.project.findUnique({ where: { id: s.projects.p1.id } });
        expect(p1).not.toBeNull();
    });

    test('findUnique() runs as findFirst: ABAC conditions apply', async () => {
        await withConfig({}, async (prisma) => {
            // base Project.USER.findFirst = ProjectAccessCondition (own OR member)
            const accessible: any = await asUser(s.users.alice, () =>
                (prisma.model.project as any).findUnique({ where: { id: s.projects.p3.id } }),
            );
            expect(accessible?.id).toBe(s.projects.p3.id); // alice is a member of p3

            const blocked = await asUser(s.users.alice, () =>
                (prisma.model.project as any).findUnique({ where: { id: s.projects.p4.id } }),
            );
            expect(blocked).toBeNull(); // p4 is dave's; not accessible → filtered
        });
    });
});
