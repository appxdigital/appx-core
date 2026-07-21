/**
 * Option A — every foreign-key reference in a `create` is authorized by the
 * target model's `connect` rule, however it is supplied (raw scalar FK or the
 * `connect` form), with no bypass. The sole exception is the auto-filled back-FK
 * to a same-request nesting parent, which is trusted.
 *
 * Create conditions judge the model's OWN scalar fields only — relationship
 * authorization lives entirely in `connect`.
 *
 * Each relation shape is tested for both ACCESS (allowed when the rule is
 * satisfied) and LOCK (denied when the rule is missing or unsatisfied).
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;

describe('create foreign-key authorization (Option A — connect required)', () => {
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

    // ── Raw scalar FK ───────────────────────────────────────────────────────

    test('raw FK ALLOWED when the target connect rule is satisfied', async () => {
        await withConfig(
            {
                Project: { USER: { create: 'ALL' } },
                User: { USER: { connect: { conditions: { id: $UID } } } }, // may attach only yourself
            },
            async (prisma) => {
                const res: any = await asUser(s.users.alice, () =>
                    prisma.model.project.create({ data: { name: 'RawOk', ownerId: s.users.alice.id } }),
                );
                expect(res?.id).toBeDefined();
            },
        );
        expect(await raw.project.findFirst({ where: { name: 'RawOk' } })).not.toBeNull();
    });

    // Note: "no connect rule at all on a required-FK target" is rejected at BOOT by
    // the config validator (see test/unit/permissions-validator.spec.ts), so it
    // cannot be exercised at runtime — the module won't construct.

    test('raw FK LOCKED when the connect rule is not satisfied by the target', async () => {
        await withConfig(
            {
                Project: { USER: { create: 'ALL' } },
                User: { USER: { connect: { conditions: { id: $UID } } } }, // only yourself
            },
            async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        // Attaching bob as owner — connect rule requires id === caller.
                        prisma.model.project.create({ data: { name: 'RawForged', ownerId: s.users.bob.id } }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
            },
        );
        expect(await raw.project.findFirst({ where: { name: 'RawForged' } })).toBeNull();
    });

    test('the raw FK and the `connect` form authorize identically', async () => {
        // Same rule, same denial, whichever syntax the payload uses.
        const cfg = {
            Project: { USER: { create: 'ALL' } },
            User: { USER: { connect: { conditions: { id: $UID } } } },
        };
        await withConfig(cfg, async (prisma) => {
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.project.create({ data: { name: 'FormRaw', ownerId: s.users.bob.id } }),
                ),
            ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.project.create({ data: { name: 'FormConnect', owner: { connect: { id: s.users.bob.id } } } }),
                ),
            ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
        });
    });

    // ── Own-field create conditions still work (relationships aside) ─────────

    test('own-scalar create condition is enforced independently of connect', async () => {
        await withConfig(
            {
                // Self-ownership on the FK column stays a create-condition check…
                Project: { USER: { create: { conditions: { ownerId: $UID } } } },
                User: { USER: { connect: 'ALL' } }, // …and the FK still needs a connect rule
            },
            async (prisma) => {
                // ownerId satisfies the create condition AND connect → allowed.
                const ok: any = await asUser(s.users.alice, () =>
                    prisma.model.project.create({ data: { name: 'Owned', ownerId: s.users.alice.id } }),
                );
                expect(ok?.id).toBeDefined();
                // Connect allows any user, but the create condition still forbids a non-self owner.
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.project.create({ data: { name: 'NotOwned', ownerId: s.users.bob.id } }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'create' permission/i);
            },
        );
    });

    // ── Nested create: back-FK to the parent is trusted ─────────────────────

    test('nested create ALLOWED — parent back-FK trusted, other FKs still checked', async () => {
        await withConfig(
            {
                Project: { USER: { create: { conditions: { ownerId: $UID } } } },
                User: { USER: { connect: 'ALL' } }, // ownerId (Project) + assigneeId (Task)
                Task: { USER: { create: 'ALL' } },
            },
            async (prisma) => {
                const res: any = await asUser(s.users.alice, () =>
                    prisma.model.project.create({
                        data: {
                            name: 'WithTask',
                            ownerId: s.users.alice.id,
                            // Task.projectId (back-FK) is filled by Prisma → trusted;
                            // Task.assigneeId is a real FK → needs User.connect.
                            tasks: { create: [{ title: 'child', assigneeId: s.users.alice.id }] },
                        },
                    }),
                );
                expect(res?.id).toBeDefined();
            },
        );
        expect((await raw.task.findMany({ where: { title: 'child' } })).length).toBe(1);
    });

    test('nested create LOCKED when a non-parent FK on the child lacks a connect rule', async () => {
        await withConfig(
            {
                Project: { USER: { create: { conditions: { ownerId: $UID } } } },
                User: { USER: { connect: { conditions: { id: $UID } } } }, // only self as owner
                Task: { USER: { create: 'ALL' } },
            },
            async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.project.create({
                            data: {
                                name: 'BadAssignee',
                                ownerId: s.users.alice.id,
                                // assigneeId = bob violates User.connect (only self allowed).
                                tasks: { create: [{ title: 'child', assigneeId: s.users.bob.id }] },
                            },
                        }),
                    ),
                ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
            },
        );
        expect(await raw.project.findFirst({ where: { name: 'BadAssignee' } })).toBeNull();
    });

    // ── Multiple relations to the same model must be disambiguated ───────────

    test('multi-relation child: correct back-FK trusted by name, sibling FK still checked', async () => {
        // Nest a Task under a User's `assignedTasks`. Task ↔ User has TWO relations
        // (assignee via "AssigneeTasks", reviewer via "ReviewerTasks"). The back-FK
        // is `assigneeId` (trusted); `reviewerId` is a sibling FK to the SAME model
        // and must still satisfy User.connect — so relation-name pairing has to pick
        // the right one, not "any FK pointing at User".
        const cfg = {
            User: { USER: { create: 'ALL', connect: { conditions: { id: $UID } } } }, // connect only self
            Task: { USER: { create: 'ALL' } },
            Project: { USER: { connect: 'ALL' } },
        };
        await withConfig(cfg, async (prisma) => {
            // reviewer = self → allowed (assigneeId back-FK trusted, reviewerId self passes)
            // Explicit id above the pinned seed range: the seed inserts users with
            // explicit ids, which does not advance postgres' serial sequence, so a
            // sequence-assigned id would collide with alice (id=1).
            const ok: any = await asUser(s.users.alice, () =>
                prisma.model.user.create({
                    data: {
                        id: 9001,
                        email: 'nested-ok@t.io',
                        assignedTasks: { create: [{ title: 'x', projectId: s.projects.p1.id, reviewerId: s.users.alice.id }] },
                    },
                }),
            );
            expect(ok?.id).toBeDefined();

            // reviewer = bob → denied: proves reviewerId is NOT mistaken for the trusted back-FK.
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.user.create({
                        data: {
                            id: 9002,
                            email: 'nested-bad@t.io',
                            assignedTasks: { create: [{ title: 'y', projectId: s.projects.p1.id, reviewerId: s.users.bob.id }] },
                        },
                    }),
                ),
            ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
        });
        expect(await raw.user.findFirst({ where: { email: 'nested-bad@t.io' } })).toBeNull();
    });

    // ── Self-relation nesting ───────────────────────────────────────────────

    test('self-relation nested create — parent back-FK trusted', async () => {
        // A reply nested under a comment: parentId is the trusted back-FK.
        await withConfig(
            {
                Comment: { USER: { create: 'ALL' } },
                User: { USER: { connect: 'ALL' } }, // authorId on both comments
                Task: { USER: { connect: 'ALL' } }, // taskId raw FK
            },
            async (prisma) => {
                const res: any = await asUser(s.users.alice, () =>
                    prisma.model.comment.create({
                        data: {
                            body: 'parent',
                            taskId: s.tasks.t1.id,
                            authorId: s.users.alice.id,
                            replies: { create: [{ body: 'child', taskId: s.tasks.t1.id, authorId: s.users.alice.id }] },
                        },
                    }),
                );
                expect(res?.id).toBeDefined();
            },
        );
        expect((await raw.comment.findMany({ where: { body: 'child' } })).length).toBe(1);
    });
});
