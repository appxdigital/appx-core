/**
 * Relation-scoped `connect` rules. A rule declared on the SOURCE model, keyed by
 * the relation field (`relations: { assignee: { connect: {...} } }`), constrains
 * who may be attached through THAT relation — something the per-target-model
 * `connect` rule can't express.
 *
 * Semantics (option A + standalone):
 *   - both the relation rule and the target's `connect` rule present → ANDed
 *     (the relation rule can only strengthen).
 *   - only the relation rule present → it stands alone; the target needs no rule.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, buildAbacModule, newRawClient, asUser } from './helpers';

describe('relation-scoped connect rules', () => {
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

    // Restrict who may be a task's assignee to USER-role users. root (id 99) is
    // ADMIN, so it must be rejected even though the base User.connect is 'ALL'.
    const assigneeMustBeUser = {
        Task: { USER: { create: 'ALL', relations: { assignee: { connect: { conditions: { role: 'USER' } } } } } },
    };

    test('strengthen: a target the destination rule alone would allow is still denied by the relation rule', async () => {
        // Base User.USER.connect = 'ALL' would allow attaching root; the relation
        // rule (role: USER) narrows it.
        await withConfig(assigneeMustBeUser, async (prisma) => {
            // USER-role assignee → allowed
            const ok: any = await asUser(s.users.alice, () =>
                prisma.model.task.create({ data: { title: 'ok', projectId: s.projects.p1.id, assigneeId: s.users.alice.id } }),
            );
            expect(ok?.id).toBeDefined();

            // ADMIN-role assignee → denied by the relation rule
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.task.create({ data: { title: 'bad', projectId: s.projects.p1.id, assigneeId: s.users.root.id } }),
                ),
            ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
        });
        expect(await raw.task.findFirst({ where: { title: 'bad' } })).toBeNull();
    });

    test('applies to the `connect` form as well as the raw FK', async () => {
        await withConfig(assigneeMustBeUser, async (prisma) => {
            // Prisma forbids mixing a scalar FK with a relation form in one create,
            // so attach the project via `connect` too.
            await expect(
                asUser(s.users.alice, () =>
                    prisma.model.task.create({
                        data: { title: 'bad2', project: { connect: { id: s.projects.p1.id } }, assignee: { connect: { id: s.users.root.id } } },
                    }),
                ),
            ).rejects.toThrow(/does not satisfy the 'connect' permission/i);

            const ok: any = await asUser(s.users.alice, () =>
                prisma.model.task.create({
                    data: { title: 'ok2', project: { connect: { id: s.projects.p1.id } }, assignee: { connect: { id: s.users.bob.id } } },
                }),
            );
            expect(ok?.id).toBeDefined();
        });
    });

    test('the relation rule stands alone when the target model has no connect rule', async () => {
        // No User block at all → User has no `connect` rule; the relation rule on
        // Task.assignee is the only thing authorizing the association.
        const { prisma, rawClient, close } = await buildAbacModule({
            Task: { USER: { create: 'ALL', relations: { assignee: { connect: { conditions: { role: 'USER' } } } } } },
            Project: { USER: { connect: 'ALL' } },
        } as any);
        try {
            await resetAbac(rawClient);
            const seeded = await seedAbac(rawClient);
            const ok: any = await asUser(seeded.users.alice, () =>
                prisma.model.task.create({ data: { title: 'solo', projectId: seeded.projects.p1.id, assigneeId: seeded.users.alice.id } }),
            );
            expect(ok?.id).toBeDefined();

            await expect(
                asUser(seeded.users.alice, () =>
                    prisma.model.task.create({ data: { title: 'solo-bad', projectId: seeded.projects.p1.id, assigneeId: seeded.users.root.id } }),
                ),
            ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
        } finally {
            await resetAbac(rawClient);
            await close();
        }
    });
});
