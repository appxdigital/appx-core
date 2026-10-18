/**
 * `set` on a write rule: the server writes those column values on every write
 * the rule allows, overriding the client's. Set values are authorized like any
 * other — checked against the create `conditions`, and a set foreign key
 * against its `connect` rule (never trusted).
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;
const selfOwner = { relations: { owner: { connect: { conditions: { id: $UID } } } } };

describe('`set` — server-set column values', () => {
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

    const dropProjects = (names: string[]) => raw.project.deleteMany({ where: { name: { in: names } } });

    test('create: the set value replaces the client value', async () => {
        try {
            await withConfig({ Project: { USER: { create: { set: { ownerId: $UID } }, ...selfOwner } } }, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.project.create({ data: { name: 'S-own', ownerId: s.users.alice.id } }),
                );
                expect(row.ownerId).toBe(s.users.bob.id);
            });
        } finally {
            await dropProjects(['S-own']);
        }
    });

    test('create: set values are checked against the create conditions', async () => {
        try {
            await withConfig(
                { Project: { USER: { create: { conditions: { status: 'draft' }, set: { ownerId: $UID, status: 'draft' } }, ...selfOwner } } },
                async (prisma) => {
                    const row: any = await asUser(s.users.bob, () =>
                        prisma.model.project.create({ data: { name: 'S-draft', ownerId: s.users.bob.id, status: 'active' } }),
                    );
                    expect(row.status).toBe('draft');
                },
            );
            await withConfig(
                { Project: { USER: { create: { conditions: { status: 'active' }, set: { ownerId: $UID, status: 'draft' } }, ...selfOwner } } },
                async (prisma) => {
                    await expect(
                        asUser(s.users.bob, () =>
                            prisma.model.project.create({ data: { name: 'S-denied', ownerId: s.users.bob.id, status: 'active' } }),
                        ),
                    ).rejects.toThrow(/does not satisfy the 'create' permission/);
                },
            );
        } finally {
            await dropProjects(['S-draft', 'S-denied']);
        }
    });

    test('createMany: applied to every row', async () => {
        try {
            await withConfig({ Project: { USER: { create: { set: { ownerId: $UID } }, ...selfOwner } } }, async (prisma) => {
                await asUser(s.users.bob, () =>
                    prisma.model.project.createMany({
                        data: [
                            { name: 'S-m1', ownerId: s.users.alice.id },
                            { name: 'S-m2', ownerId: s.users.dave.id },
                        ],
                    }),
                );
            });
            const rows = await raw.project.findMany({ where: { name: { in: ['S-m1', 'S-m2'] } } });
            expect(rows.map((r: any) => r.ownerId)).toEqual([s.users.bob.id, s.users.bob.id]);
        } finally {
            await dropProjects(['S-m1', 'S-m2']);
        }
    });

    test('a set foreign key is still authorized by its connect rule', async () => {
        await withConfig(
            {
                Task: {
                    USER: {
                        create: { set: { assigneeId: $UID } },
                        relations: { assignee: { connect: { conditions: { id: 999 } } } },
                    },
                },
            },
            async (prisma) => {
                await expect(
                    asUser(s.users.bob, () =>
                        prisma.model.task.create({ data: { title: 'S-task', projectId: s.projects.p1.id } }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'connect' permission/);
            },
        );
        expect(await raw.task.count({ where: { title: 'S-task' } })).toBe(0);
    });

    test('updateMany: the set value is written on update', async () => {
        try {
            await withConfig(
                { Project: { USER: { updateMany: { conditions: { ownerId: $UID }, set: { status: 'archived' } } } } },
                async (prisma) => {
                    const res: any = await asUser(s.users.alice, () =>
                        prisma.model.project.updateMany({ where: { id: s.projects.p2.id }, data: { name: 'Beta' } }),
                    );
                    expect(res.count).toBe(1);
                },
            );
            expect((await raw.project.findUnique({ where: { id: s.projects.p2.id } })).status).toBe('archived');
        } finally {
            await raw.project.update({ where: { id: s.projects.p2.id }, data: { status: 'active' } });
        }
    });

    test('nested create: the child rule\'s set values apply to the child', async () => {
        try {
            await withConfig(
                { Task: { USER: { create: 'ALL' } }, Comment: { USER: { create: { set: { authorId: $UID } } } } },
                async (prisma) => {
                    await asUser(s.users.bob, () =>
                        prisma.model.task.create({
                            data: {
                                title: 'S-nested',
                                projectId: s.projects.p1.id,
                                comments: { create: [{ body: 'S-n1', authorId: s.users.alice.id }] },
                            } as any,
                        }),
                    );
                },
            );
            const comment = await raw.comment.findFirst({ where: { body: 'S-n1' } });
            expect(comment.authorId).toBe(s.users.bob.id);
        } finally {
            await raw.comment.deleteMany({ where: { body: 'S-n1' } });
            await raw.task.deleteMany({ where: { title: 'S-nested' } });
        }
    });

    test('not applied when the rule is bypassed (exposed model / BYPASS_FILTERING) or has no set', async () => {
        try {
            await withConfig({ Project: { USER: { create: { set: { ownerId: $UID } }, ...selfOwner } } }, async (prisma) => {
                const exposed: any = await asUser(
                    s.users.bob,
                    () => prisma.model.project.create({ data: { name: 'S-exp', ownerId: s.users.alice.id } }),
                    ['project', 'user'], // the owner FK is still authorized unless its target is exposed too
                );
                const bypassed: any = await asUser(s.users.bob, () =>
                    (prisma.model.project.create as any)({ data: { name: 'S-byp', ownerId: s.users.alice.id } }, { BYPASS_FILTERING: true }),
                );
                expect(exposed.ownerId).toBe(s.users.alice.id);
                expect(bypassed.ownerId).toBe(s.users.alice.id);
            });
            await withConfig({ Project: { USER: { create: 'ALL' } } }, async (prisma) => {
                const plain: any = await asUser(s.users.bob, () =>
                    prisma.model.project.create({ data: { name: 'S-all', ownerId: s.users.alice.id } }),
                );
                expect(plain.ownerId).toBe(s.users.alice.id);
            });
        } finally {
            await dropProjects(['S-exp', 'S-byp', 'S-all']);
        }
    });
});
