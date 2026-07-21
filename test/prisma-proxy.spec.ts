/**
 * Prisma proxy / ABAC engine — core behaviour tests.
 *
 * Converged onto the rich schema (Tenant/User/Project/ProjectMember/Task/
 * Comment + additions) via the shared ABAC harness, so the proxy is exercised
 * against the same schema real consumers use rather than a toy Post/Category
 * one. Relation-condition breadth lives in test/abac/relations.spec.ts; this
 * file pins the engine invariants (blacklist, filtering, omission, bypass,
 * exposed-models, create enforcement, count fallback).
 */
import { buildAbacModule, withConfig, asUser } from './abac/helpers';
import { abacPermissions } from './abac/permissions';
import { seedAbac, resetAbac, SeededAbac } from './abac/seed';
import { PermissionPlaceholder } from '../src/common/config/permissionsConfigTypes';
import type { PrismaService } from '../src/prisma/prisma.service';

const $UID = PermissionPlaceholder.USER_ID;

let prisma: PrismaService;
let rawClient: any;
let close: () => Promise<void>;
let s: SeededAbac;

beforeAll(async () => {
    ({ prisma, rawClient, close } = await buildAbacModule(abacPermissions));
});

afterAll(async () => {
    if (close) await close();
});

beforeEach(async () => {
    await resetAbac(rawClient);
    s = await seedAbac(rawClient);
});

describe('single-record methods redirect to their filter-compatible form', () => {
    test('findUnique() runs as findFirst (conditions apply)', async () => {
        await asUser({ id: 99, role: 'ADMIN' }, async () => {
            const row: any = await (prisma.model as any).project.findUnique({ where: { id: s.projects.p1.id } });
            expect(row?.id).toBe(s.projects.p1.id);
        });
    });

    test('update() runs as updateMany (returns a count)', async () => {
        await asUser({ id: 99, role: 'ADMIN' }, async () => {
            const res: any = await prisma.model.project.update({ where: { id: s.projects.p1.id }, data: { name: 'x' } });
            expect(res).toEqual({ count: 1 });
        });
    });

    test('delete() runs as deleteMany (returns a count)', async () => {
        await asUser({ id: 99, role: 'ADMIN' }, async () => {
            const res: any = await prisma.model.project.delete({ where: { id: s.projects.p1.id } });
            expect(res).toEqual({ count: 1 });
        });
    });
});

describe('ABAC where-filtering on reads', () => {
    test('USER findMany returns only own projects (conditions { ownerId: $UID })', async () => {
        await withConfig(
            { Project: { USER: { findMany: { conditions: { ownerId: $UID } } } } },
            async (p) => {
                const rows = (await asUser({ id: s.users.alice.id, role: 'USER' }, () => p.model.project.findMany({}))) as any[];
                expect(rows).toHaveLength(2); // p1, p2
                expect(rows.every((r) => r.ownerId === s.users.alice.id)).toBe(true);
            },
        );
    });

    test('ADMIN findMany returns every project', async () => {
        const rows = (await asUser({ id: 99, role: 'ADMIN' }, () => prisma.model.project.findMany({}))) as any[];
        expect(rows.length).toBe(4);
    });

    test('USER findMany on User (conditions { id: $UID }) returns only self', async () => {
        await withConfig(
            { User: { USER: { findMany: { conditions: { id: $UID } } } } },
            async (p) => {
                const rows = (await asUser({ id: s.users.alice.id, role: 'USER' }, () => p.model.user.findMany({}))) as any[];
                expect(rows).toHaveLength(1);
                expect(rows[0].id).toBe(s.users.alice.id);
            },
        );
    });

    test('GUEST (unauthenticated) is default-denied → 403', async () => {
        await expect(asUser(null, () => prisma.model.project.findMany({}))).rejects.toThrow(/permissions|Forbidden|403/i);
    });
});

describe('field-level omission (@Role(ADMIN) on Project.secretApiKey)', () => {
    test('USER read does NOT include secretApiKey', async () => {
        const p1 = (await asUser({ id: s.users.alice.id, role: 'USER' }, () =>
            prisma.model.project.findFirst({ where: { id: s.projects.p1.id } }),
        )) as any;
        expect(p1).toBeTruthy();
        expect(p1.secretApiKey).toBeUndefined();
    });

    test('ADMIN read DOES include secretApiKey', async () => {
        const p1 = (await asUser({ id: 99, role: 'ADMIN' }, () =>
            prisma.model.project.findFirst({ where: { id: s.projects.p1.id } }),
        )) as any;
        expect(p1.secretApiKey).toBe('sk-A');
    });
});

describe('BYPASS_FILTERING / BYPASS_OMISSION escape hatches', () => {
    test('BYPASS_FILTERING lets unauthenticated lookup-by-email work (auth use case)', async () => {
        const u = (await asUser(null, () =>
            (prisma.user as any).findFirst({ where: { email: s.users.alice.email } }, { BYPASS_FILTERING: true }),
        )) as any;
        expect(u).toBeTruthy();
        expect(u.id).toBe(s.users.alice.id);
    });

    test('BYPASS_OMISSION reveals an omitted field (auth password lookup)', async () => {
        // `prisma.user` is one of the hardcoded direct accessors that accept
        // BYPASS options; password is @Role(none) and normally omitted.
        const u = (await asUser({ id: s.users.alice.id, role: 'USER' }, () =>
            (prisma.user as any).findFirst(
                { where: { id: s.users.alice.id } },
                { BYPASS_FILTERING: true, BYPASS_OMISSION: true },
            ),
        )) as any;
        expect(u.password).toBe('hash-alice');
    });
});

describe('withExposedModels', () => {
    test('exposed model is treated as ALL during the callback', async () => {
        const rows = (await asUser(
            { id: 99, role: 'USER' }, // USER normally can't see all projects
            () => prisma.model.project.findMany({}),
            ['project'], // expose Project -> bypass filtering
        )) as any[];
        expect(rows.length).toBe(4);
    });
});

describe('conditions on create are enforced', () => {
    // Under Option A the comment's FK references (taskId, authorId) are each
    // authorized by the target's connect rule; grant them so the create-condition
    // (own-scalar authorId self-check) is what these tests exercise.
    const CREATE_OWN = {
        Comment: { USER: { create: { conditions: { authorId: $UID } } } },
        Task: { USER: { connect: 'ALL' } },
        User: { USER: { connect: 'ALL' } },
    };

    test('USER cannot create a Comment attributed to ANOTHER user', async () => {
        await withConfig(CREATE_OWN, async (p) => {
            await expect(
                asUser({ id: s.users.alice.id, role: 'USER' }, () =>
                    p.model.comment.create({ data: { body: 'forged', taskId: s.tasks.t1.id, authorId: s.users.bob.id } }),
                ),
            ).rejects.toThrow(/not allowed to create/i);
        });
        const forged = await rawClient.comment.findMany({ where: { body: 'forged' } });
        expect(forged.length).toBe(0); // nothing inserted
    });

    test('USER can create a Comment attributed to themselves', async () => {
        await withConfig(CREATE_OWN, async (p) => {
            const c = (await asUser({ id: s.users.alice.id, role: 'USER' }, () =>
                p.model.comment.create({ data: { body: 'mine', taskId: s.tasks.t1.id, authorId: s.users.alice.id } }),
            )) as any;
            expect(c.authorId).toBe(s.users.alice.id);
        });
    });
});

describe('count fallback to read permission', () => {
    test('count honours the findMany conditions (Comment { authorId: $UID })', async () => {
        // Base Comment.USER = { authorId: $UID }; alice authored only c1.
        const n = await asUser({ id: s.users.alice.id, role: 'USER' }, () => (prisma.model.comment as any).count());
        expect(n).toBe(1);
    });
});
