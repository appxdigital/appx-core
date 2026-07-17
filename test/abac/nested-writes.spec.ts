/**
 * Nested relation writes on the create path — explicit allowlist.
 *
 * Only `create` (child must satisfy the related model's `create` rule) and
 * `connect` (target must satisfy the related model's dedicated `connect` rule)
 * are permitted; every other nested operator is rejected (fail closed).
 * Nested writes reach Prisma only via `create()` — `updateMany`/`createMany`
 * take scalar data only.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;

// Base delta: let a USER create a project they own.
const projectCreate = { Project: { USER: { create: { conditions: { ownerId: $UID } } } } };

describe('nested relation writes (create-path allowlist)', () => {
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

    test('nested `create` allowed when the child create rule is satisfied', async () => {
        await withConfig({ ...projectCreate, Task: { USER: { create: 'ALL' } } }, async (prisma) => {
            const res: any = await asUser(s.users.alice, () =>
                prisma.model.project.create({
                    data: { name: 'Nested', ownerId: s.users.alice.id, tasks: { create: [{ title: 'child' }] } },
                }),
            );
            expect(res?.id).toBeDefined();
        });
        expect((await raw.task.findMany({ where: { title: 'child' } })).length).toBe(1);
    });

    test('nested `create` denied when the child create rule is NOT satisfied', async () => {
        await withConfig(
            { ...projectCreate, Task: { USER: { create: { conditions: { title: 'allowed' } } } } },
            async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.project.create({
                            data: { name: 'Nested', ownerId: s.users.alice.id, tasks: { create: [{ title: 'forbidden' }] } },
                        }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'create' permission/i);
            },
        );
        expect(await raw.project.findFirst({ where: { name: 'Nested' } })).toBeNull();
    });

    test('nested `connect` denied when the target model has no connect permission', async () => {
        await withConfig(projectCreate, async (prisma) => {
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.project.create({
                        data: { name: 'WithTag', ownerId: s.users.alice.id, tags: { connect: [{ id: s.tags.urgent.id }] } },
                    }),
                ),
            ).rejects.toThrow(/no 'connect' permission on Tag/i);
        });
    });

    test('nested `connect` allowed when the target satisfies the connect rule', async () => {
        await withConfig(
            { ...projectCreate, Tag: { USER: { connect: { conditions: { name: 'urgent' } } } } },
            async (prisma) => {
                const res: any = await asUser(s.users.alice, () =>
                    prisma.model.project.create({
                        data: { name: 'WithUrgent', ownerId: s.users.alice.id, tags: { connect: [{ id: s.tags.urgent.id }] } },
                    }),
                );
                expect(res?.id).toBeDefined();
            },
        );
        const p = await raw.project.findFirst({ where: { name: 'WithUrgent' }, include: { tags: true } });
        expect(p.tags.map((t: any) => t.name)).toContain('urgent');
    });

    test('nested `connect` denied when the target does NOT satisfy the connect rule', async () => {
        await withConfig(
            { ...projectCreate, Tag: { USER: { connect: { conditions: { name: 'urgent' } } } } },
            async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.project.create({
                            data: { name: 'WithSecret', ownerId: s.users.alice.id, tags: { connect: [{ id: s.tags.secret.id }] } },
                        }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
            },
        );
    });

    test('an unprotected nested operator (`set`) is rejected (fail closed)', async () => {
        await withConfig(projectCreate, async (prisma) => {
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.project.create({
                        data: { name: 'WithSet', ownerId: s.users.alice.id, tags: { set: [{ id: s.tags.urgent.id }] } },
                    }),
                ),
            ).rejects.toThrow(/Nested 'set'.*not supported/i);
        });
    });
});
