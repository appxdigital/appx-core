/**
 * Create-condition evaluation against the relation `connect` form.
 *
 * A `create` condition that constrains a scalar foreign key (e.g.
 * `{ ownerId: $USER_ID }`) must still be evaluated correctly when the payload
 * supplies that association via the relation's `connect` form
 * (`owner: { connect: { id } }`) instead of the scalar. The proxy resolves the
 * connect target back to the scalar FK using relation metadata — no naming or
 * pluralization assumptions. Applies on both the top-level create and nested
 * `create` children.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;

describe('create conditions vs the relation `connect` form', () => {
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

    test('scalar-FK condition passes when the FK is supplied via `connect` (own id)', async () => {
        await withConfig(
            {
                Project: { USER: { create: { conditions: { ownerId: $UID } } } },
                // The owner is attached via `connect`, so the target model needs a connect rule.
                User: { USER: { connect: 'ALL' } },
            },
            async (prisma) => {
                const res: any = await asUser(s.users.alice, () =>
                    prisma.model.project.create({
                        // No scalar `ownerId` — the owner is associated via connect.
                        data: { name: 'ByConnect', owner: { connect: { id: s.users.alice.id } } },
                    }),
                );
                expect(res?.id).toBeDefined();
            },
        );
        const row = await raw.project.findFirst({ where: { name: 'ByConnect' } });
        expect(row?.ownerId).toBe(s.users.alice.id);
    });

    test('scalar-FK condition still DENIES when the connected id fails it', async () => {
        await withConfig(
            { Project: { USER: { create: { conditions: { ownerId: $UID } } } } },
            async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.project.create({
                            // Connecting bob as owner while the rule requires ownerId === caller.
                            data: { name: 'Forged', owner: { connect: { id: s.users.bob.id } } },
                        }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'create' permission/i);
            },
        );
        expect(await raw.project.findFirst({ where: { name: 'Forged' } })).toBeNull();
    });

    test('resolution flows into nested `create` children', async () => {
        await withConfig(
            {
                Project: { USER: { create: { conditions: { ownerId: $UID } } } },
                // A comment may be created only when the caller is the author;
                // here the author is supplied via `connect`, not the scalar.
                Comment: { USER: { create: { conditions: { authorId: $UID } } } },
                Task: { USER: { create: 'ALL' } },
                // The comment's author is attached via `connect`.
                User: { USER: { connect: 'ALL' } },
            },
            async (prisma) => {
                const res: any = await asUser(s.users.alice, () =>
                    prisma.model.task.create({
                        data: {
                            // Scalar FK for the parent project keeps this test focused on
                            // the nested comment's connect-form author.
                            title: 'with-comment',
                            projectId: s.projects.p1.id,
                            comments: {
                                create: [{ body: 'hi', author: { connect: { id: s.users.alice.id } } }],
                            },
                        },
                    }),
                );
                expect(res?.id).toBeDefined();
            },
        );
        expect((await raw.comment.findMany({ where: { body: 'hi' } })).length).toBe(1);
    });

    test('nested `create` child still DENIED when the connected author fails the rule', async () => {
        await withConfig(
            {
                Comment: { USER: { create: { conditions: { authorId: $UID } } } },
                Task: { USER: { create: 'ALL' } },
                User: { USER: { connect: 'ALL' } },
            },
            async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.task.create({
                            data: {
                                title: 'bad-comment',
                                projectId: s.projects.p1.id,
                                comments: {
                                    create: [{ body: 'nope', author: { connect: { id: s.users.bob.id } } }],
                                },
                            },
                        }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'create' permission/i);
            },
        );
        expect(await raw.comment.findFirst({ where: { body: 'nope' } })).toBeNull();
    });
});
