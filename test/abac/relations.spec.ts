/**
 * §1 — Comprehensive ABAC relation-condition matrix.
 *
 * Exercises the Prisma proxy (the security boundary) against the rich schema on
 * the isolated `appx_abac` DB, using the canonical seed (§1.0.3). Each test
 * installs the exact permission shape it needs via `withConfig` and reads as a
 * seeded actor via `asUser`, then asserts which rows survive the proxy filter.
 *
 * This file starts with §1.1 (single-level conditions); further groups
 * (§1.2 list filters, §1.3 nesting, §1.4 null-cascade, …) are added on top.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';
import { ProjectAccessCondition } from './permissions';
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;
const ids = (rows: any) => (rows as any[]).map((r) => r.id).sort((a, b) => a - b);

// Reusable rule shapes referenced by several groups below.
// A comment is reachable if the project behind its task is reachable (depth-3).
const CommentByProject = { task: { project: ProjectAccessCondition } };

describe('§1 ABAC relation matrix', () => {
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

    describe('§1.1 — single-level conditions', () => {
        test('1.1.1 — direct equals: USER sees only projects they own (ownerId = $UID)', async () => {
            await withConfig(
                { Project: { USER: { findMany: { conditions: { ownerId: $UID } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.project.findMany({}));
                    expect(ids(rows)).toEqual(ids([s.projects.p1, s.projects.p2]));
                },
            );
        });

        test('1.1.2 — `not` operator on a direct field', async () => {
            await withConfig(
                { Project: { USER: { findMany: { conditions: { ownerId: { not: $UID } } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.project.findMany({}));
                    // Projects not owned by alice → p3 (bob), p4 (dave).
                    expect(ids(rows)).toEqual(ids([s.projects.p3, s.projects.p4]));
                },
            );
        });

        test('1.1.3 — `in` array narrows by status', async () => {
            await withConfig(
                { Project: { USER: { findMany: { conditions: { status: { in: ['active', 'draft'] } } } } } },
                async (prisma) => {
                    const rows = (await asUser(s.users.alice, () => prisma.model.project.findMany({}))) as any[];
                    expect(rows.length).toBe(4); // all four match active|draft
                },
            );
            await withConfig(
                { Project: { USER: { findMany: { conditions: { status: { in: ['active'] } } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.project.findMany({}));
                    // p3 is "draft" → filtered out.
                    expect(ids(rows)).toEqual(ids([s.projects.p1, s.projects.p2, s.projects.p4]));
                },
            );
        });

        test('1.1.4 — a role with no rule for the model is default-denied (403 throw)', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser({ role: 'GUEST' }, () => prisma.model.project.findMany({})),
                ).rejects.toThrow(/No permissions found/i);
            });
        });

        test('1.1.5 — implicit AND: user-supplied where combines with the permission condition', async () => {
            // Base Task.USER = { project: ProjectAccessCondition }; alice can reach p1.
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.alice, () =>
                    prisma.model.task.findMany({ where: { projectId: s.projects.p1.id } }),
                );
                // Tasks in p1: t1, t2, t3.
                expect(ids(rows)).toEqual(ids([s.tasks.t1, s.tasks.t2, s.tasks.t3]));
            });
        });

        test('1.1.6 — cross-actor isolation: dave cannot reach alice-only projects', async () => {
            await withConfig(
                { Project: { USER: { findMany: { conditions: { ownerId: $UID } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.dave, () => prisma.model.project.findMany({}));
                    // dave owns only p4.
                    expect(ids(rows)).toEqual(ids([s.projects.p4]));
                },
            );
        });
    });

    describe('§1.2 — list-relation filters (some / every / none)', () => {
        test('1.2.1 — `some` on explicit join (ProjectMember): owner OR member', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.alice, () => prisma.model.project.findMany({}));
                // alice owns p1/p2, is a member of p1/p2/p3 → p1, p2, p3.
                expect(ids(rows)).toEqual(ids([s.projects.p1, s.projects.p2, s.projects.p3]));
            });
        });

        test('1.2.2 — `every` on hasMany members (empty-list edge via a seed delta)', async () => {
            // Default seed: every project has ≥1 manager, so `every contributor` matches none.
            await withConfig(
                { Project: { USER: { findMany: { conditions: { members: { every: { role: 'contributor' } } } } } } },
                async (prisma) => {
                    const rows = (await asUser(s.users.alice, () => prisma.model.project.findMany({}))) as any[];
                    expect(rows.length).toBe(0);
                },
            );

            // Seed delta: a project whose only member is a contributor.
            const solo = await raw.project.create({ data: { name: 'Solo', ownerId: s.users.root.id, status: 'active' } });
            await raw.projectMember.create({ data: { projectId: solo.id, userId: s.users.carol.id, role: 'contributor' } });
            try {
                await withConfig(
                    { Project: { USER: { findMany: { conditions: { members: { every: { role: 'contributor' } } } } } } },
                    async (prisma) => {
                        const rows = await asUser(s.users.carol, () => prisma.model.project.findMany({}));
                        expect(ids(rows)).toEqual([solo.id]);
                    },
                );
            } finally {
                await raw.projectMember.deleteMany({ where: { projectId: solo.id } });
                await raw.project.delete({ where: { id: solo.id } });
            }
        });

        test('1.2.3 — `none` on implicit M:N tags', async () => {
            await withConfig(
                { Project: { USER: { findMany: { conditions: { tags: { none: { name: 'secret' } } } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.project.findMany({}));
                    // Only p4 carries the 'secret' tag; p3 has no tags (none=true on empty).
                    expect(ids(rows)).toEqual(ids([s.projects.p1, s.projects.p2, s.projects.p3]));
                },
            );
        });

        describe('empty-list edges (seed delta: tenant T3 with zero users)', () => {
            let t3: any;
            beforeAll(async () => {
                t3 = await raw.tenant.create({ data: { name: 'Empty' } });
            });
            afterAll(async () => {
                await raw.tenant.delete({ where: { id: t3.id } });
            });

            test('1.2.4 — `some` is FALSE on an empty list (T3 excluded)', async () => {
                await withConfig(
                    { Tenant: { USER: { findMany: { conditions: { users: { some: { id: $UID } } } } } } },
                    async (prisma) => {
                        const rows = (await asUser(s.users.alice, () => prisma.model.tenant.findMany({}))) as any[];
                        const got = ids(rows);
                        expect(got).toContain(s.tenants.T1.id);
                        expect(got).not.toContain(t3.id);
                        expect(got).toEqual([s.tenants.T1.id]);
                    },
                );
            });

            test('1.2.5 — `every` is TRUE on an empty list (T3 included)', async () => {
                await withConfig(
                    { Tenant: { USER: { findMany: { conditions: { users: { every: { role: 'USER' } } } } } } },
                    async (prisma) => {
                        const rows = (await asUser(s.users.alice, () => prisma.model.tenant.findMany({}))) as any[];
                        const got = ids(rows);
                        // No tenant has an ADMIN member (root has no tenant) → all three qualify.
                        expect(got).toContain(t3.id);
                        expect(got).toEqual(ids([s.tenants.T1, s.tenants.T2, { id: t3.id }]));
                    },
                );
            });

            test('1.2.6 — `none` is TRUE on an empty list (T3 included)', async () => {
                await withConfig(
                    { Tenant: { USER: { findMany: { conditions: { users: { none: { role: 'ADMIN' } } } } } } },
                    async (prisma) => {
                        const rows = (await asUser(s.users.alice, () => prisma.model.tenant.findMany({}))) as any[];
                        const got = ids(rows);
                        expect(got).toContain(t3.id);
                        expect(got).toEqual(ids([s.tenants.T1, s.tenants.T2, { id: t3.id }]));
                    },
                );
            });
        });

        test('1.2.7 — user-supplied `some` AND-merges with the permission condition', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.alice, () =>
                    prisma.model.project.findMany({ where: { tasks: { some: { assigneeId: s.users.alice.id } } } }),
                );
                // Only p1 has a task assigned to alice (t1), and alice can access p1.
                expect(ids(rows)).toEqual(ids([s.projects.p1]));
            });
        });

        test('1.2.8 — `some` with no match returns null (findFirst)', async () => {
            await withConfig({}, async (prisma) => {
                const row = await asUser(s.users.bob, () =>
                    prisma.model.project.findFirst({ where: { members: { some: { userId: 999 } } } }),
                );
                expect(row).toBeNull();
            });
        });
    });

    describe('§1.3 — multi-level nesting', () => {
        test('1.3.1 — depth 1 (ProjectMember → Project → OR)', async () => {
            await withConfig(
                { ProjectMember: { USER: { findMany: { conditions: { project: ProjectAccessCondition } } } } },
                async (prisma) => {
                    const rows = (await asUser(s.users.alice, () => prisma.model.projectMember.findMany({}))) as any[];
                    // Every membership row in an alice-accessible project (p1/p2/p3):
                    // p1{alice,bob,carol}, p2{alice}, p3{alice,bob} = 6 rows.
                    expect(rows.length).toBe(6);
                },
            );
        });

        test('1.3.2 — depth 2 (Task → Project → OR)', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.alice, () => prisma.model.task.findMany({}));
                // Tasks in p1/p3 (accessible); t5 in p4 excluded.
                expect(ids(rows)).toEqual(ids([s.tasks.t1, s.tasks.t2, s.tasks.t3, s.tasks.t4]));
            });
        });

        test('1.3.3 — depth 3 (Comment → Task → Project → OR) as owner', async () => {
            await withConfig(
                { Comment: { USER: { findMany: { conditions: CommentByProject } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.comment.findMany({}));
                    // c1/c2/c3 on t1(p1), c4 on t4(p3); c5 on t5(p4) excluded.
                    expect(ids(rows)).toEqual(ids([s.comments.c1, s.comments.c2, s.comments.c3, s.comments.c4]));
                },
            );
        });

        test('1.3.4 — depth 3 exercising the MEMBER branch of the OR (as carol)', async () => {
            await withConfig(
                { Comment: { USER: { findMany: { conditions: CommentByProject } } } },
                async (prisma) => {
                    // carol owns nothing; she is only a member of p1 → reaches t1's comments only.
                    const rows = await asUser(s.users.carol, () => prisma.model.comment.findMany({}));
                    expect(ids(rows)).toEqual(ids([s.comments.c1, s.comments.c2, s.comments.c3]));
                },
            );
        });
    });

    describe('§1.4 — null-cascade behaviour ⚠ (pins current behaviour)', () => {
        // NOTE (framework finding, see local SECURITY.md notes): for a belongsTo
        // relation, the related-model read conditions are merged into the PARENT
        // row's WHERE, not applied as a nested filter. So including a relation whose
        // target row is non-null but unreadable drops the ENTIRE parent row (returns
        // null / omits it), rather than returning the parent with the relation nulled.
        // The optional-relation OR-null branch only rescues the case where the FK is
        // actually NULL. hasMany relations behave differently: they are filtered
        // in-place and the parent is preserved (empty/partial list). These tests pin
        // that observed contract.

        test('1.4.1 — optional belongsTo, target non-null & UNREADABLE → parent dropped (null)', async () => {
            await withConfig({}, async (prisma) => {
                // bob reads t1 via p1 membership; t1.assignee = alice (unreadable to bob).
                const row = await asUser(s.users.bob, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, include: { assignee: true } }),
                );
                expect(row).toBeNull();
            });
        });

        test('1.4.2 — optional NAMED belongsTo (reviewer), target unreadable → parent dropped (null)', async () => {
            await withConfig({}, async (prisma) => {
                // t2.reviewer = alice (unreadable to bob); t2.assignee = bob (not included here).
                const row = await asUser(s.users.bob, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t2.id }, include: { reviewer: true } }),
                );
                expect(row).toBeNull();
            });
        });

        test('1.4.3 — optional belongsTo, FK is null → parent preserved, relation null', async () => {
            await withConfig({}, async (prisma) => {
                // t3.assigneeId is null → OR-null branch keeps the row.
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t3.id }, include: { assignee: true } }),
                );
                expect(row?.id).toBe(s.tasks.t3.id);
                expect(row?.assignee).toBeNull();
            });
        });

        test('1.4.4 — REQUIRED belongsTo, target unreadable → parent dropped (null)', async () => {
            // Task readable by anyone; Project only if you own it. bob owns no project.
            await withConfig(
                {
                    Task: { USER: { findFirst: 'ALL' } },
                    Project: { USER: { findFirst: { conditions: { ownerId: $UID } } } },
                },
                async (prisma) => {
                    const row = await asUser(s.users.bob, () =>
                        prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, include: { project: true } }),
                    );
                    // Current behaviour: candidate (b) — the parent task is silently dropped.
                    // (Desired contract is {...t1, project:null}; a required relation can't be
                    //  nulled, so this pins the drop. See local SECURITY.md.)
                    expect(row).toBeNull();
                },
            );
        });

        test('1.4.5 — hasMany, parent OK, all children readable → full list', async () => {
            // Nested hasMany filtering uses the related model's findMany rule.
            await withConfig(
                { Comment: { USER: { findFirst: { conditions: CommentByProject }, findMany: { conditions: CommentByProject } } } },
                async (prisma) => {
                    const row: any = await asUser(s.users.alice, () =>
                        prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, include: { comments: true } }),
                    );
                    expect(row?.id).toBe(s.tasks.t1.id);
                    expect(ids(row.comments)).toEqual(ids([s.comments.c1, s.comments.c2, s.comments.c3]));
                },
            );
        });

        test('1.4.6 — hasMany, parent OK, NO child readable → empty list, parent preserved', async () => {
            await withConfig(
                { Comment: { USER: { findFirst: { conditions: { authorId: $UID } } } } },
                async (prisma) => {
                    // bob manages p3 → reads t4; t4's only comment is c4 (carol) — unreadable.
                    const row: any = await asUser(s.users.bob, () =>
                        prisma.model.task.findFirst({ where: { id: s.tasks.t4.id }, include: { comments: true } }),
                    );
                    expect(row?.id).toBe(s.tasks.t4.id);
                    expect(row.comments).toEqual([]);
                },
            );
        });

        test('1.4.7 — hasMany, mix readable+unreadable → partial list, parent preserved', async () => {
            await withConfig(
                { Comment: { USER: { findFirst: { conditions: { authorId: $UID } } } } },
                async (prisma) => {
                    // bob reads t1 (p1 member); comments c1(alice)/c2(bob)/c3(carol) → only c2.
                    const row: any = await asUser(s.users.bob, () =>
                        prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, include: { comments: true } }),
                    );
                    expect(row?.id).toBe(s.tasks.t1.id);
                    expect(ids(row.comments)).toEqual(ids([s.comments.c2]));
                },
            );
        });

        test('1.4.8 — self-relation optional parent unreadable → parent dropped (null)', async () => {
            await withConfig(
                { Comment: { USER: { findFirst: { conditions: { authorId: $UID } } } } },
                async (prisma) => {
                    // carol reads c3 (she authored it); c3.parent = c2 (bob) unreadable.
                    const row = await asUser(s.users.carol, () =>
                        prisma.model.comment.findFirst({ where: { id: s.comments.c3.id }, include: { parent: true } }),
                    );
                    expect(row).toBeNull();
                },
            );
        });

        test('1.4.9 — self-relation list (replies), children filtered → parent preserved', async () => {
            await withConfig(
                { Comment: { USER: { findFirst: { conditions: { authorId: $UID } } } } },
                async (prisma) => {
                    // alice authored c1; c1.replies = [c2] (bob) → filtered out, list empty.
                    const row: any = await asUser(s.users.alice, () =>
                        prisma.model.comment.findFirst({ where: { id: s.comments.c1.id }, include: { replies: true } }),
                    );
                    expect(row?.id).toBe(s.comments.c1.id);
                    expect(row.replies).toEqual([]);
                },
            );
        });

        test('1.4.10 — parent itself unreadable → null', async () => {
            await withConfig({}, async (prisma) => {
                // t5 is in p4; bob has no access to p4.
                const row = await asUser(s.users.bob, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t5.id } }),
                );
                expect(row).toBeNull();
            });
        });
    });

    describe('§1.5 — cross-tenant isolation', () => {
        test('1.5.1 — findMany is tenant-scoped (dave sees only p4)', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.dave, () => prisma.model.project.findMany({}));
                expect(ids(rows)).toEqual(ids([s.projects.p4]));
            });
        });

        test('1.5.2 — findFirst by id across tenants silently filters (null, not 403)', async () => {
            await withConfig({}, async (prisma) => {
                const row = await asUser(s.users.dave, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id } }),
                );
                expect(row).toBeNull();
            });
        });

        test('1.5.3 — updateMany across tenants affects zero rows (and does not mutate)', async () => {
            await withConfig(
                { Project: { USER: { updateMany: { conditions: { ownerId: $UID } } } } },
                async (prisma) => {
                    const res: any = await asUser(s.users.dave, () =>
                        prisma.model.project.updateMany({ where: { id: s.projects.p1.id }, data: { name: 'hijack' } }),
                    );
                    expect(res.count).toBe(0);
                },
            );
            const fresh = await raw.project.findUnique({ where: { id: s.projects.p1.id } });
            expect(fresh.name).toBe('Alpha');
        });

        test('1.5.4 — create FK associations are enforced (cross-tenant attach denied, no row)', async () => {
            // Under Option A the "may attach a project you own" rule lives on
            // Project.connect (create conditions no longer reach across relations).
            // dave owns p4, not p1, so attaching p1 is denied by the connect rule.
            await withConfig(
                {
                    ProjectMember: { USER: { create: 'ALL' } },
                    Project: { USER: { connect: { conditions: { ownerId: $UID } } } },
                    User: { USER: { connect: 'ALL' } },
                },
                async (prisma) => {
                    await expect(
                        asUser(s.users.dave, () =>
                            prisma.model.projectMember.create({
                                data: { projectId: s.projects.p1.id, userId: s.users.dave.id, role: 'manager' },
                            }),
                        ),
                    ).rejects.toThrow(/does not satisfy the 'connect' permission/i);
                },
            );
            const leaked = await raw.projectMember.findFirst({
                where: { projectId: s.projects.p1.id, userId: s.users.dave.id },
            });
            expect(leaked).toBeNull();
        });
    });

    describe('§1.6 — negative-path (default-deny)', () => {
        test('1.6.1 — action undefined for role → 403', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () => prisma.model.session.findFirst({})),
                ).rejects.toThrow(/No permissions found/i);
            });
        });

        test('1.6.2 — role undefined entirely → 403', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser({ id: 1, role: 'AUDITOR' }, () => prisma.model.project.findMany({})),
                ).rejects.toThrow(/No permissions found/i);
            });
        });

        test('1.6.3 — unauthenticated (GUEST) → 403', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(null, () => prisma.model.project.findMany({})),
                ).rejects.toThrow(/No permissions found/i);
            });
        });

        test('1.6.4 — GUEST explicitly granted ALL → sees everything', async () => {
            await withConfig(
                { Project: { GUEST: { findMany: 'ALL' } } },
                async (prisma) => {
                    const rows = (await asUser(null, () => prisma.model.project.findMany({}))) as any[];
                    expect(rows.length).toBe(4);
                },
            );
        });
    });

    describe('§1.7 — 1:1 relation (UserProfile) + field omission', () => {
        test('1.7.1 — USER reads own profile; @Role(ADMIN) field omitted', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.userProfile.findFirst({ where: { userId: s.users.alice.id } }),
                );
                expect(row?.userId).toBe(s.users.alice.id);
                expect(row.billingInfo).toBeUndefined();
                expect(row.bio).toBe('founder');
            });
        });

        test('1.7.2 — ADMIN sees the sensitive field', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.root, () =>
                    prisma.model.userProfile.findFirst({ where: { userId: s.users.alice.id } }),
                );
                expect(row.billingInfo).toBe('card-A');
            });
        });

        test('1.7.3 — 1:1 absent at DB → null', async () => {
            await withConfig({}, async (prisma) => {
                const row = await asUser(s.users.carol, () =>
                    prisma.model.userProfile.findFirst({ where: { userId: s.users.carol.id } }),
                );
                expect(row).toBeNull();
            });
        });

        test('1.7.4 — 1:1 via include from parent, sensitive field still omitted', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { profile: true } }),
                );
                expect(row?.id).toBe(s.users.alice.id);
                expect(row.profile?.id).toBe(s.profiles.alice.id);
                expect(row.profile.billingInfo).toBeUndefined();
            });
        });

        test('1.7.5 — 1:1 include, profile UNREADABLE → parent dropped (null)', async () => {
            await withConfig(
                { UserProfile: { USER: { findFirst: { conditions: { userId: 999 } } } } },
                async (prisma) => {
                    // alice's profile is non-null but fails the (impossible) condition → row dropped.
                    const row = await asUser(s.users.alice, () =>
                        prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { profile: true } }),
                    );
                    expect(row).toBeNull();
                },
            );
        });
    });

    describe('§1.8 — self-relation (manager hierarchy + comment threads)', () => {
        test('1.8.1 — self belongsTo, manager unreadable → parent dropped (null)', async () => {
            await withConfig({}, async (prisma) => {
                // bob's manager is alice; bob can't read alice → including manager drops bob.
                const row = await asUser(s.users.bob, () =>
                    prisma.model.user.findFirst({ where: { id: s.users.bob.id }, include: { manager: true } }),
                );
                expect(row).toBeNull();
            });
        });

        test('1.8.2 — self hasMany: my direct reports', async () => {
            await withConfig(
                { User: { USER: { findMany: { conditions: { managerId: $UID } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.user.findMany({}));
                    expect(ids(rows)).toEqual(ids([s.users.bob, s.users.carol]));
                },
            );
        });

        describe('1.8.3 — 2-level hierarchy (seed delta: dan reports to bob)', () => {
            let dan: any;
            beforeAll(async () => {
                dan = await raw.user.create({
                    data: { id: 5, email: 'dan@t.io', password: 'hash-dan', role: 'USER', tenantId: s.tenants.T1.id, managerId: s.users.bob.id },
                });
            });
            afterAll(async () => {
                await raw.user.delete({ where: { id: dan.id } });
            });

            test('self + direct reports + grand-reports', async () => {
                await withConfig(
                    {
                        User: {
                            USER: {
                                findMany: {
                                    conditions: { OR: [{ id: $UID }, { managerId: $UID }, { manager: { managerId: $UID } }] },
                                },
                            },
                        },
                    },
                    async (prisma) => {
                        const rows = await asUser(s.users.alice, () => prisma.model.user.findMany({}));
                        expect(ids(rows)).toEqual(ids([s.users.alice, s.users.bob, s.users.carol, dan]));
                    },
                );
            });
        });

        test('1.8.4 — self hasMany via include (reports)', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { reports: true } }),
                );
                expect(row?.id).toBe(s.users.alice.id);
                expect(ids(row.reports)).toEqual(ids([s.users.bob, s.users.carol]));
            });
        });

        test('1.8.5 — self-relation thread chain via nested include', async () => {
            await withConfig(
                { Comment: { USER: { findFirst: { conditions: CommentByProject } } } },
                async (prisma) => {
                    // alice owns p1 → all comments on t1 readable; walk c3 → c2 → c1.
                    const row: any = await asUser(s.users.alice, () =>
                        prisma.model.comment.findFirst({
                            where: { id: s.comments.c3.id },
                            include: { parent: { include: { parent: true } } },
                        }),
                    );
                    expect(row?.id).toBe(s.comments.c3.id);
                    expect(row.parent?.id).toBe(s.comments.c2.id);
                    expect(row.parent.parent?.id).toBe(s.comments.c1.id);
                },
            );
        });
    });

    describe('§1.9 — multiple named relations between the same pair (Task ↔ User)', () => {
        test('1.9.1 — routes by `assignee` field name', async () => {
            await withConfig(
                { Task: { USER: { findMany: { conditions: { assigneeId: $UID } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.task.findMany({}));
                    expect(ids(rows)).toEqual(ids([s.tasks.t1]));
                },
            );
        });

        test('1.9.2 — routes by `reviewer` field name', async () => {
            await withConfig(
                { Task: { USER: { findMany: { conditions: { reviewerId: $UID } } } } },
                async (prisma) => {
                    const rows = await asUser(s.users.alice, () => prisma.model.task.findMany({}));
                    expect(ids(rows)).toEqual(ids([s.tasks.t2]));
                },
            );
        });

        test('1.9.3 — both names AND-ed → no task qualifies', async () => {
            await withConfig(
                { Task: { USER: { findMany: { conditions: { AND: [{ assigneeId: $UID }, { reviewerId: $UID }] } } } } },
                async (prisma) => {
                    const rows = (await asUser(s.users.alice, () => prisma.model.task.findMany({}))) as any[];
                    expect(rows.length).toBe(0);
                },
            );
        });

        test('1.9.4 — include both named relations, one unreadable → parent dropped (null)', async () => {
            await withConfig({}, async (prisma) => {
                // t4.assignee = carol (unreadable to bob), t4.reviewer = bob (readable).
                // The belongsTo conditions conjoin across both fields and gate the parent.
                const row = await asUser(s.users.bob, () =>
                    prisma.model.task.findFirst({
                        where: { id: s.tasks.t4.id },
                        include: { assignee: true, reviewer: true },
                    }),
                );
                expect(row).toBeNull();
            });
        });
    });

    describe('§1.10 — implicit M:N (Project ↔ Tag)', () => {
        test('1.10.1 — reverse traversal: tags on accessible projects', async () => {
            await withConfig({}, async (prisma) => {
                const rows: any[] = (await asUser(s.users.alice, () => prisma.model.tag.findMany({}))) as any[];
                const names = rows.map((r) => r.name).sort();
                // p1(urgent,frontend) + p2(frontend) accessible; 'secret' only on p4 (no access).
                expect(names).toEqual(['frontend', 'urgent']);
            });
        });

        test('1.10.2 — user-supplied M:N filter AND-merges with permission', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.alice, () =>
                    prisma.model.project.findMany({ where: { tags: { some: { name: 'urgent' } } } }),
                );
                // p1 (urgent, accessible); p4 also urgent but inaccessible.
                expect(ids(rows)).toEqual(ids([s.projects.p1]));
            });
        });

        test('1.10.3 — M:N include, full list', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, include: { tags: true } }),
                );
                expect(row?.id).toBe(s.projects.p1.id);
                expect(row.tags.map((t: any) => t.name).sort()).toEqual(['frontend', 'urgent']);
            });
        });

        test('1.10.4 — M:N include with a partially-unreadable tag list', async () => {
            await withConfig(
                { Tag: { USER: { findMany: { conditions: { name: { not: 'frontend' } } } } } },
                async (prisma) => {
                    const row: any = await asUser(s.users.alice, () =>
                        prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, include: { tags: true } }),
                    );
                    expect(row?.id).toBe(s.projects.p1.id);
                    expect(row.tags.map((t: any) => t.name).sort()).toEqual(['urgent']);
                },
            );
        });
    });
});
