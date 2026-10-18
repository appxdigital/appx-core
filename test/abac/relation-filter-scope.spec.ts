/**
 * Relations reached by a query take part only through the related rows the
 * caller can read.
 *
 *   - client relation filters (`where`, nested `select.where`, `_count` where):
 *     narrowed to readable related rows; into a model with no read rule → 403
 *   - relations selected below a to-one relation: filtered like the first level
 *   - `orderBy` on a related to-one field: that record must be readable (like
 *     selecting it); `orderBy` a to-many `_count`: only when fully readable
 *   - `_count` selections: count readable related rows only
 *
 * Fixtures (base `abacPermissions` + canonical seed):
 *   - UserRefreshToken has NO rule for any role. A token is seeded for bob.
 *   - User.USER = self + direct reports: alice reads alice/bob/carol; bob reads bob.
 *   - bob reads t1..t4 (p1 member, p3 owner). t1.assignee = alice, t2.assignee = bob,
 *     t3 has no assignee. p1.owner = alice, p3.owner = bob.
 *   - t1.comments = c1 (alice), c2 (bob), c3 (carol); Comment.USER = own only,
 *     so bob reads c2 alone.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';
import { ProjectAccessCondition } from './permissions';

const ids = (rows: any) => (rows as any[]).map((r) => r.id).sort((a, b) => a - b);

const BOB_TOKEN = 'rt-bob-0123456789';
// A comment is readable when its task's project is (alice: all of t1's comments).
const CommentByProject = { task: { project: ProjectAccessCondition } };
const CommentsByProject = { Comment: { USER: { findFirst: { conditions: CommentByProject }, findMany: { conditions: CommentByProject } } } };

describe('relations take part only through readable related rows', () => {
    let raw: any;
    let s: SeededAbac;

    beforeAll(async () => {
        raw = newRawClient();
        await raw.$connect();
        await resetAbac(raw);
        s = await seedAbac(raw);
        await raw.userRefreshToken.create({
            data: { token: BOB_TOKEN, userId: s.users.bob.id, expiresAt: new Date(Date.now() + 86_400_000) },
        });
    });

    afterAll(async () => {
        await raw.userRefreshToken.deleteMany({});
        await resetAbac(raw);
        await raw.$disconnect();
    });

    describe('client filter into a model with no read rule → 403', () => {
        const byTokenPrefix = (prefix: string) => ({
            id: s.users.bob.id,
            refreshTokens: { some: { token: { startsWith: prefix } } },
        });

        test('count', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () => prisma.model.user.count({ where: byTokenPrefix('rt-bob-0') })),
                ).rejects.toThrow(/Cannot filter by 'user.refreshTokens'/);
            });
        });

        test('findMany', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () => prisma.model.user.findMany({ where: byTokenPrefix('rt-bob-9') })),
                ).rejects.toThrow(/Cannot filter by 'user.refreshTokens'/);
            });
        });

        test('reached through a to-one relation', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.task.count({
                            where: { id: s.tasks.t2.id, assignee: { is: { refreshTokens: { some: { token: { startsWith: 'rt-bob-0' } } } } } },
                        }),
                    ),
                ).rejects.toThrow(/Cannot filter by 'User.refreshTokens'/);
            });
        });

        test('allowed when the model is exposed', async () => {
            await withConfig({}, async (prisma) => {
                const count = await asUser(
                    s.users.alice,
                    () => prisma.model.user.count({ where: byTokenPrefix('rt-bob-0') }),
                    ['userrefreshtoken'],
                );
                expect(count).toBe(1);
            });
        });
    });

    describe('client filter into a model with a conditional rule — readable rows only', () => {
        const countTask = (prisma: any, id: number, where: any) =>
            asUser(s.users.bob, () => prisma.model.task.count({ where: { id, ...where } }));

        test('`some` — ignores unreadable rows, matches readable ones', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { comments: { some: { body: 'c1' } } })).toBe(0);
                expect(await countTask(prisma, s.tasks.t1.id, { comments: { some: { body: 'c2' } } })).toBe(1);
            });
        });

        test('`none` — unreadable rows don\'t count against it', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { comments: { none: { body: 'c1' } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t1.id, { comments: { none: { body: 'c2' } } })).toBe(0);
            });
        });

        test('`every` — holds over the readable rows', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { comments: { every: { authorId: s.users.bob.id } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t1.id, { comments: { every: { body: 'zz' } } })).toBe(0);
            });
        });

        test('to-one `is` / shorthand — no match on an unreadable row', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { assignee: { is: { email: 'alice@t.io' } } })).toBe(0);
                expect(await countTask(prisma, s.tasks.t1.id, { assignee: { email: 'alice@t.io' } })).toBe(0);
                expect(await countTask(prisma, s.tasks.t2.id, { assignee: { is: { email: 'bob@t.io' } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t2.id, { assignee: { email: 'bob@t.io' } })).toBe(1);
            });
        });

        test('to-one `isNot` — an unreadable row never matches the filter', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { assignee: { isNot: { email: 'alice@t.io' } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t1.id, { assignee: { isNot: { email: 'nobody@t.io' } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t2.id, { assignee: { isNot: { email: 'bob@t.io' } } })).toBe(0);
            });
        });

        test('outer `NOT` around a to-many filter', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { NOT: { comments: { some: { body: 'c1' } } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t1.id, { NOT: { comments: { some: { body: 'c2' } } } })).toBe(0);
            });
        });

        test('outer `NOT` around a to-one filter — same answer whatever the unreadable value', async () => {
            // alice's managerId is NULL: the read rule must stay false (not NULL) under negation.
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { NOT: { assignee: { email: 'alice@t.io' } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t1.id, { NOT: { assignee: { email: 'nobody@t.io' } } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t2.id, { NOT: { assignee: { email: 'bob@t.io' } } })).toBe(0);
            });
        });

        test('inside `OR`', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t1.id, { OR: [{ title: 'nope' }, { comments: { some: { body: 'c1' } } }] })).toBe(0);
                expect(await countTask(prisma, s.tasks.t1.id, { OR: [{ title: 'nope' }, { comments: { some: { body: 'c2' } } }] })).toBe(1);
            });
        });

        test('to-one presence checks are unchanged', async () => {
            await withConfig({}, async (prisma) => {
                expect(await countTask(prisma, s.tasks.t3.id, { assignee: null })).toBe(1);
                expect(await countTask(prisma, s.tasks.t3.id, { assignee: { is: null } })).toBe(1);
                expect(await countTask(prisma, s.tasks.t1.id, { assignee: { isNot: null } })).toBe(1);
            });
        });

        test('updateMany count', async () => {
            await withConfig(
                { Task: { USER: { updateMany: { conditions: { project: ProjectAccessCondition } } } } },
                async (prisma) => {
                    const res: any = await asUser(s.users.bob, () =>
                        prisma.model.task.updateMany({
                            where: { id: s.tasks.t1.id, comments: { some: { body: 'c1' } } },
                            data: { status: s.tasks.t1.status },
                        }),
                    );
                    expect(res.count).toBe(0);
                },
            );
        });
    });

    describe('client filter into a fully readable model — unchanged', () => {
        test('`ALL` rule (Tenant)', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.alice, () => prisma.model.user.findMany({ where: { tenant: { name: 'Acme' } } }));
                expect(ids(rows)).toEqual(ids([s.users.alice, s.users.bob, s.users.carol]));
            });
        });

        test('ADMIN (`ALL` everywhere)', async () => {
            await withConfig({}, async (prisma) => {
                const count = await asUser(s.users.root, () =>
                    prisma.model.task.count({ where: { id: s.tasks.t1.id, comments: { some: { body: 'c1' } } } }),
                );
                expect(count).toBe(1);
            });
        });

        test('conditional rule where every related row is readable', async () => {
            await withConfig(CommentsByProject, async (prisma) => {
                // alice reads all of t1's comments → same result as an unscoped filter.
                const count = await asUser(s.users.alice, () =>
                    prisma.model.task.count({ where: { id: s.tasks.t1.id, comments: { some: { body: 'c3' } } } }),
                );
                expect(count).toBe(1);
            });
        });
    });

    describe('nested select `where`', () => {
        test('into a model with no read rule → 403', async () => {
            await withConfig(CommentsByProject, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.task.findFirst({
                            where: { id: s.tasks.t1.id },
                            select: {
                                id: true,
                                comments: {
                                    where: { author: { refreshTokens: { some: { token: { startsWith: 'rt-bob-0' } } } } },
                                    select: { id: true },
                                },
                            },
                        }),
                    ),
                ).rejects.toThrow(/Cannot filter by 'User.refreshTokens'/);
            });
        });

        test('by a `@Role(none)` field → 403, as at the top level', async () => {
            await withConfig(CommentsByProject, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.task.findFirst({
                            where: { id: s.tasks.t1.id },
                            select: { id: true, comments: { where: { author: { password: { startsWith: 'hash-b' } } }, select: { id: true } } },
                        }),
                    ),
                ).rejects.toThrow(/Cannot filter by 'User.password'/);
            });
        });

        test('relation filter scoped to readable rows', async () => {
            await withConfig(CommentsByProject, async (prisma) => {
                const select = (email: string) => ({
                    id: true,
                    comments: { where: { author: { email } }, select: { id: true } },
                });
                // alice reads bob → c2; bob can't read alice → no comment matches.
                const asAlice: any = await asUser(s.users.alice, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, select: select('bob@t.io') }),
                );
                const asBob: any = await asUser(s.users.bob, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, select: select('alice@t.io') }),
                );
                expect(ids(asAlice.comments)).toEqual([s.comments.c2.id]);
                expect(asBob.comments).toEqual([]);
            });
        });
    });

    describe('relations selected below a to-one relation', () => {
        test('to-one → to-many is filtered', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.comment.findFirst({ where: { id: s.comments.c2.id }, include: { task: { include: { comments: true } } } }),
                );
                expect(row.task.id).toBe(s.tasks.t1.id);
                expect(ids(row.task.comments)).toEqual([s.comments.c2.id]);
            });
        });

        test('to-one → to-one: an unreadable record drops the row', async () => {
            await withConfig(
                { ProjectMember: { USER: { findMany: { conditions: { userId: s.users.bob.id } } } } },
                async (prisma) => {
                    const rows: any = await asUser(s.users.bob, () =>
                        prisma.model.projectMember.findMany({
                            select: { id: true, project: { select: { name: true, owner: { select: { id: true, email: true } } } } },
                        }),
                    );
                    // bob's memberships: p1 (owner alice — unreadable) and p3 (owner bob).
                    expect(rows.map((r: any) => r.project.name)).toEqual(['Gamma']);
                    expect(JSON.stringify(rows)).not.toContain('alice@t.io');
                },
            );
        });

        test('three levels deep (to-one → to-one → to-one)', async () => {
            await withConfig({}, async (prisma) => {
                const select = { id: true, task: { select: { id: true, project: { select: { id: true, owner: { select: { email: true } } } } } } };
                const onP1 = await asUser(s.users.bob, () => prisma.model.comment.findFirst({ where: { id: s.comments.c2.id }, select }));
                expect(onP1).toBeNull();
            });
        });

        test('a model with no read rule below a to-one → 403', async () => {
            await withConfig({ User: { USER: { findFirst: undefined, findMany: undefined } } }, async (prisma) => {
                await expect(
                    asUser(s.users.bob, () =>
                        prisma.model.comment.findFirst({ where: { id: s.comments.c2.id }, include: { task: { include: { assignee: true } } } }),
                    ),
                ).rejects.toThrow(/Missing permissions on model User/);
            });
        });

        test('exposed model below a to-one is not filtered', async () => {
            await withConfig({}, async (prisma) => {
                // t2.assignee = bob, who authored c2 — not readable by alice (own comments only).
                const read = (exposed: string[]) =>
                    asUser(
                        s.users.alice,
                        () => prisma.model.task.findFirst({ where: { id: s.tasks.t2.id }, include: { assignee: { include: { comments: true } } } }),
                        exposed,
                    );
                const filtered: any = await read([]);
                const exposed: any = await read(['comment']);
                expect(filtered.assignee.comments).toEqual([]);
                expect(ids(exposed.assignee.comments)).toEqual([s.comments.c2.id]);
            });
        });

        test('fully readable chain is returned whole', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t2.id }, include: { project: { include: { owner: true } }, assignee: true } }),
                );
                expect(row.project.owner.id).toBe(s.users.alice.id);
                expect(row.assignee.id).toBe(s.users.bob.id);
            });
        });
    });

    describe('orderBy across a relation', () => {
        test('to-one: rows whose related record is unreadable are left out', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.bob, () =>
                    prisma.model.task.findMany({
                        where: { id: { in: [s.tasks.t1.id, s.tasks.t2.id] } },
                        orderBy: { assignee: { email: 'desc' } },
                        select: { id: true },
                    }),
                );
                // t1.assignee = alice (unreadable) → excluded; t2.assignee = bob.
                expect(ids(rows)).toEqual([s.tasks.t2.id]);
            });
        });

        test('to-one, two levels deep', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.bob, () =>
                    prisma.model.task.findMany({ orderBy: [{ project: { owner: { email: 'asc' } } }], select: { id: true } }),
                );
                // t1..t3 are in p1 (owner alice, unreadable); t4 is in p3 (owner bob).
                expect(ids(rows)).toEqual([s.tasks.t4.id]);
            });
        });

        test('to-one with a readable related record — order kept', async () => {
            await withConfig({}, async (prisma) => {
                const rows: any = await asUser(s.users.alice, () =>
                    prisma.model.task.findMany({
                        where: { id: { in: [s.tasks.t1.id, s.tasks.t2.id] } },
                        orderBy: { assignee: { email: 'desc' } },
                        select: { id: true },
                    }),
                );
                expect(rows.map((r: any) => r.id)).toEqual([s.tasks.t2.id, s.tasks.t1.id]); // bob@ > alice@
            });
        });

        test('to-one into a model with no read rule → 403', async () => {
            await withConfig({ Project: { USER: { findFirst: undefined, findMany: undefined } } }, async (prisma) => {
                await expect(
                    asUser(s.users.bob, () => prisma.model.task.findMany({ orderBy: { project: { name: 'asc' } } })),
                ).rejects.toThrow(/Cannot order by 'task.project'/);
            });
        });

        test('to-many `_count`: conditional rule → 403; `ALL` / exposed → allowed', async () => {
            await withConfig({}, async (prisma) => {
                const byTaskCount = { orderBy: { tasks: { _count: 'desc' } }, select: { id: true } } as any;
                await expect(asUser(s.users.bob, () => prisma.model.project.findMany(byTaskCount))).rejects.toThrow(
                    /Cannot order by 'project.tasks'/,
                );
                const asAdmin: any = await asUser(s.users.root, () => prisma.model.project.findMany(byTaskCount));
                expect(asAdmin[0].id).toBe(s.projects.p1.id); // p1 has three tasks
                const exposed: any = await asUser(s.users.bob, () => prisma.model.project.findMany(byTaskCount), ['task']);
                expect(exposed[0].id).toBe(s.projects.p1.id);
            });
        });

        test('orderBy inside a nested to-many selection is scoped too', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.project.findFirst({
                        where: { id: s.projects.p1.id },
                        select: { id: true, tasks: { orderBy: { assignee: { email: 'asc' } }, select: { id: true } } },
                    }),
                );
                // t1 (assignee alice, unreadable) left out; t2 (bob) and t3 (no assignee) kept.
                expect(ids(row.tasks)).toEqual(ids([s.tasks.t2, s.tasks.t3]));
            });
        });
    });

    describe('`_count`', () => {
        test('counts readable related rows only', async () => {
            await withConfig({ Task: { USER: { findMany: { conditions: { assigneeId: s.users.bob.id } } } } }, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, select: { id: true, _count: { select: { tasks: true } } } }),
                );
                expect(row._count.tasks).toBe(1); // t2 only (of t1/t2/t3)
            });
        });

        test('`_count: true` scopes every counted relation', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, select: { id: true, _count: true } }),
                );
                // members: bob reads his own membership only; tasks: all three; tags: both on p1.
                expect(row._count).toEqual({ members: 1, tasks: 3, tags: 2 });
            });
        });

        test('client `where` inside `_count` is scoped', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.project.findFirst({
                        where: { id: s.projects.p1.id },
                        select: { id: true, _count: { select: { tasks: { where: { assignee: { email: 'alice@t.io' } } } } } },
                    }),
                );
                expect(row._count.tasks).toBe(0);
            });
        });

        test('a model with no read rule → 403', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () =>
                        prisma.model.user.findFirst({ where: { id: s.users.bob.id }, select: { id: true, _count: { select: { refreshTokens: true } } } }),
                    ),
                ).rejects.toThrow(/Missing permissions on model UserRefreshToken/);
            });
        });

        test('ADMIN counts are unchanged', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.root, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, select: { id: true, _count: { select: { tasks: true, members: true } } } }),
                );
                expect(row._count).toEqual({ tasks: 3, members: 3 });
            });
        });
    });

    describe('realistic deep read over fully readable paths — unchanged', () => {
        // Mirrors a dashboard query: to-many chains with nested filters/order,
        // to-one relations at several depths, and a `_count`.
        const dashboard = {
            select: {
                id: true,
                name: true,
                owner: { select: { id: true, email: true, manager: { select: { id: true } } } },
                members: { orderBy: { user: { email: 'asc' } }, select: { role: true, user: { select: { id: true, email: true } } } },
                tasks: {
                    where: { status: 'open' },
                    orderBy: { id: 'asc' },
                    select: {
                        id: true,
                        assignee: { select: { id: true } },
                        comments: { orderBy: { id: 'asc' }, select: { id: true, author: { select: { id: true } } } },
                    },
                },
                _count: { select: { tasks: true } },
            },
        } as any;
        const expected = (s: SeededAbac) => ({
            id: s.projects.p1.id,
            name: 'Alpha',
            owner: { id: s.users.alice.id, email: 'alice@t.io', manager: null },
            members: [
                { role: 'manager', user: { id: s.users.alice.id, email: 'alice@t.io' } },
                { role: 'contributor', user: { id: s.users.bob.id, email: 'bob@t.io' } },
                { role: 'contributor', user: { id: s.users.carol.id, email: 'carol@t.io' } },
            ],
            tasks: [
                {
                    id: s.tasks.t1.id,
                    assignee: { id: s.users.alice.id },
                    comments: [
                        { id: s.comments.c1.id, author: { id: s.users.alice.id } },
                        { id: s.comments.c2.id, author: { id: s.users.bob.id } },
                        { id: s.comments.c3.id, author: { id: s.users.carol.id } },
                    ],
                },
                { id: s.tasks.t2.id, assignee: { id: s.users.bob.id }, comments: [] },
                { id: s.tasks.t3.id, assignee: null, comments: [] },
            ],
            _count: { tasks: 3 },
        });

        test('as ADMIN', async () => {
            await withConfig({}, async (prisma) => {
                const row = await asUser(s.users.root, () =>
                    prisma.model.project.findFirst({ ...dashboard, where: { id: s.projects.p1.id } }),
                );
                expect(row).toEqual(expected(s));
            });
        });

        test('as a USER who can read every row on the paths', async () => {
            await withConfig(
                {
                    ...CommentsByProject,
                    ProjectMember: { USER: { findMany: { conditions: { project: ProjectAccessCondition } } } },
                },
                async (prisma) => {
                    const row = await asUser(s.users.alice, () =>
                        prisma.model.project.findFirst({ ...dashboard, where: { id: s.projects.p1.id } }),
                    );
                    expect(row).toEqual(expected(s));
                },
            );
        });
    });
});
