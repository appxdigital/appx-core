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
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;
const ids = (rows: any) => (rows as any[]).map((r) => r.id).sort((a, b) => a - b);

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

        test('1.1.4 — GUEST (no matching role rule) is default-denied → empty', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser({ role: 'GUEST' }, () => prisma.model.project.findMany({}));
                expect(rows).toEqual([]);
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
});
