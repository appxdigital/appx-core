/**
 * Branch-level coverage of `PrismaService` (src/prisma/prisma.service.ts).
 *
 * Complements the behavioural suites (relations / relation-filter-scope /
 * nested-writes / …) by pinning every remaining branch of the proxy. Tests drive the public proxy (`prisma.model.<x>.<method>`)
 * wherever the branch is reachable from it; branch-level helpers that the
 * proxy only reaches with specific inputs, and purely defensive guards, are
 * called directly via `(prisma as any).<method>(...)`.
 *
 * Runs against the real `appx_abac` DB and the canonical seed. Any row a test
 * creates is removed in that test.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser, buildAbacModule } from './helpers';
import { abacPermissions } from './permissions';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';

const $UID = PermissionPlaceholder.USER_ID;
const ids = (rows: any) => (rows as any[]).map((r) => r.id).sort((a, b) => a - b);
const AUDITOR = { id: 1, role: 'AUDITOR' };

describe('PrismaService — branch coverage', () => {
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

    describe('validatePermissions', () => {
        test('logs a warning for a relation-scoped rule on an unknown relation field (boot continues)', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                await withConfig({ Tag: { USER: { updateMany: 'ALL', relations: { bogus: { connect: 'ALL' } } } } }, async (prisma) => {
                    expect(prisma).toBeInstanceOf(PrismaService);
                });
                expect(warn.mock.calls.some((c) => String(c[1]).includes('[APPX-CORE PERMISSIONS]'))).toBe(true);
            } finally {
                warn.mockRestore();
            }
        });

        test('a model entry without relationFields / noWriteFields is tolerated', async () => {
            // Defensive guard: parseSchema always sets both; injected here to exercise the fallbacks.
            await withConfig({}, async (prisma) => {
                (prisma as any).fieldConfigs.synthetic = {};
                expect(() => (prisma as any).validatePermissions()).not.toThrow();
            });
        });
    });

    describe('debugQueries / debug', () => {
        test('when enabled, emits debug lines for every level', async () => {
            const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
            try {
                await withConfig({}, async (prisma) => {
                    await asUser(s.users.alice, async () => {
                        prisma.debugQueries(true);
                        // A belongsTo include emits 'log', 'warn' and 'info' level lines.
                        await prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, include: { project: true } });
                        // No proxy path logs at 'error' level; call it directly.
                        (prisma as any).debug('error-level line', 'error');
                    });
                });
                const colors = new Set(debug.mock.calls.map((c) => c[0]));
                expect(colors).toEqual(new Set(['', '\x1b[33m', '\x1b[31m', '\x1b[34m']));
            } finally {
                debug.mockRestore();
            }
        });
    });

    describe('withExposedModels', () => {
        test('exposes the listed models for the callback (outside any existing exposure scope)', async () => {
            await withConfig({}, async (prisma) => {
                // dave can't read p1; exposing Project lifts its row filter for the callback.
                let rows: any;
                await asUser(s.users.dave, () =>
                    prisma.withExposedModels(['Project'], async () => {
                        rows = await prisma.model.project.findMany({});
                    }),
                );
                expect(rows.length).toBe(4);

                // No enclosing CorePrismaContext store at all: still resolves.
                let count: any;
                await prisma.withExposedModels(['Project'], async () => {
                    count = await prisma.model.project.count({});
                });
                expect(count).toBe(4);
            });
        });

        test('a rejecting callback rejects the returned promise', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    prisma.withExposedModels(['Project'], async () => {
                        throw new Error('boom');
                    }),
                ).rejects.toThrow('boom');
            });
        });
    });

    describe('$transaction', () => {
        test('runs the callback in a Prisma transaction', async () => {
            await withConfig({}, async (prisma) => {
                const n = await prisma.$transaction(async (tx: any) => tx.project.count());
                expect(n).toBe(4);
            });
        });
    });

    describe('proxyModels', () => {
        test('non-function members of a delegate are passed through', async () => {
            await withConfig({}, async (prisma) => {
                expect((prisma.model.project as any)._bogusInternal).toBeUndefined();
            });
        });

        test('create in development mode runs the find-back diagnostic', async () => {
            const env = process.env.NODE_ENV;
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            process.env.NODE_ENV = 'development';
            try {
                // Tag created by USER is not readable back (Tag read requires an accessible project).
                await withConfig({ Tag: { USER: { create: 'ALL' } } }, async (prisma) => {
                    const tag: any = await asUser(s.users.alice, () => prisma.model.tag.create({ data: { name: 'cov-dev-tag' } }));
                    await raw.tag.delete({ where: { id: tag.id } });
                });
                expect(warn.mock.calls.some((c) => String(c[1]).includes('cannot read it back'))).toBe(true);
            } finally {
                process.env.NODE_ENV = env;
                warn.mockRestore();
            }
        });
    });

    describe('getModelDelegate', () => {
        test('resolves a compound PascalCase model name to its delegate', async () => {
            await withConfig({}, async (prisma) => {
                const rows = await asUser(s.users.alice, () => prisma.getModelDelegate('ProjectMember' as any).findMany({}));
                expect((rows as any[]).length).toBe(3); // alice's own memberships
            });
        });

        test('throws for an unknown model', async () => {
            await withConfig({}, async (prisma) => {
                expect(() => prisma.getModelDelegate('Nope' as any)).toThrow(/Model Nope not found/);
            });
        });
    });

    describe('model / typed accessors', () => {
        test('`model` throws for a model that does not exist', async () => {
            await withConfig({}, async (prisma) => {
                expect(() => (prisma.model as any).nope).toThrow(/does not exist on PrismaClient/);
            });
        });

        test('`session` and `userRefreshToken` return proxied delegates', async () => {
            await withConfig({}, async (prisma) => {
                expect(typeof prisma.session.findMany).toBe('function');
                expect(typeof prisma.userRefreshToken.findMany).toBe('function');
            });
        });
    });

    describe('applyFieldOmission', () => {
        test('explicit `null` params are treated as empty args', async () => {
            await withConfig({}, async (prisma) => {
                const rows: any = await asUser(s.users.alice, () => prisma.model.project.findMany(null as any));
                expect(ids(rows)).toEqual(ids([s.projects.p1, s.projects.p2, s.projects.p3]));
                expect(rows[0].secretApiKey).toBeUndefined();
            });
        });

        test('nested `rel: true` inside an explicit select is narrowed to readable fields', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, select: { id: true, owner: true } }),
                );
                expect(row.owner.id).toBe(s.users.alice.id);
                expect(row.owner.password).toBeUndefined();
            });
        });

        test('nested relation args with `include` (no select) are recursed', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.task.findFirst({
                        where: { id: s.tasks.t1.id },
                        select: { id: true, project: { include: { owner: true } } },
                    }),
                );
                expect(row.project.id).toBe(s.projects.p1.id);
                expect(row.project.secretApiKey).toBeUndefined();
                expect(row.project.owner.password).toBeUndefined();
            });
        });

        test('nested relation args without a projection get a readable-field select', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findFirst({
                        where: { id: s.projects.p1.id },
                        select: { id: true, tasks: { where: { assigneeId: s.users.alice.id } } },
                    }),
                );
                expect(ids(row.tasks)).toEqual([s.tasks.t1.id]);
                expect(row.tasks[0].title).toBe('t1');
            });
        });

        test('a relation selected as `false` is left untouched', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, select: { id: true, assignee: false } }),
                );
                expect(row).toEqual({ id: s.tasks.t1.id });
            });
        });
    });

    describe('assertFilterFieldsReadable', () => {
        test('`distinct` on a readable field is allowed (array and string forms)', async () => {
            await withConfig({}, async (prisma) => {
                const a: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findMany({ distinct: ['status'], select: { status: true } }),
                );
                const b: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findMany({ distinct: 'status' as any, select: { status: true } }),
                );
                expect(a.map((r: any) => r.status).sort()).toEqual(['active', 'draft']);
                expect(b.map((r: any) => r.status).sort()).toEqual(['active', 'draft']);
            });
        });

        test('`distinct` on an unreadable field is rejected', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () => prisma.model.project.findMany({ distinct: ['secretApiKey'] })),
                ).rejects.toThrow(/Cannot filter by 'project.secretApiKey'/);
            });
        });

        test('`orderBy` on an unreadable field is rejected with an "order by" message', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () => prisma.model.project.findMany({ orderBy: { secretApiKey: 'asc' } })),
                ).rejects.toThrow(/Cannot order by 'project.secretApiKey'/);
            });
        });

        test('presence-only predicates on an unreadable field are allowed', async () => {
            await withConfig({}, async (prisma) => {
                for (const where of [
                    { secretApiKey: null },
                    { secretApiKey: { equals: null } },
                    { secretApiKey: { not: null } },
                ]) {
                    await expect(asUser(s.users.alice, () => prisma.model.project.findMany({ where }))).resolves.toBeDefined();
                }
                const nulls: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findMany({ where: { secretApiKey: null } }),
                );
                expect(ids(nulls)).toEqual(ids([s.projects.p3]));
            });
        });

        test('value-bearing predicates on an unreadable field are rejected', async () => {
            await withConfig({}, async (prisma) => {
                for (const value of ['sk-A', ['sk-A'], {}, { equals: 'sk-A' }, { contains: null }, { not: 'sk-A' }]) {
                    await expect(
                        asUser(s.users.alice, () => prisma.model.project.findMany({ where: { secretApiKey: value as any } })),
                    ).rejects.toThrow(/Cannot filter by 'project.secretApiKey'/);
                }
            });
        });

        test('a relation filter with a non-object value (`rel: null`) is accepted', async () => {
            await withConfig({}, async (prisma) => {
                const rows: any = await asUser(s.users.bob, () => prisma.model.task.findMany({ where: { assignee: null } }));
                expect(ids(rows)).toEqual(ids([s.tasks.t3]));
            });
        });

        test('defensive guard: non-object args are ignored', async () => {
            await withConfig({}, async (prisma) => {
                expect(() => (prisma as any).assertFilterFieldsReadable('Project', 'USER', null)).not.toThrow();
            });
        });
    });

    describe('applyWhereConditions', () => {
        test('`null` params with BYPASS_OMISSION are treated as empty args', async () => {
            await withConfig({}, async (prisma) => {
                const rows: any = await asUser(s.users.alice, () =>
                    (prisma.model.project.findMany as any)(null, { BYPASS_OMISSION: true }),
                );
                expect(ids(rows)).toEqual(ids([s.projects.p1, s.projects.p2, s.projects.p3]));
            });
        });

        test('no CorePrismaContext store at all → GUEST, nothing exposed', async () => {
            await withConfig({ Project: { GUEST: { findMany: 'ALL' } } }, async (prisma) => {
                const rows: any = await prisma.model.project.findMany({});
                expect(rows.length).toBe(4);
            });
        });

        test('role has rules for the model but none for the action → 403', async () => {
            const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
            try {
                await withConfig({}, async (prisma) => {
                    await expect(
                        asUser(s.users.alice, () => prisma.model.tenant.updateMany({ where: {}, data: { name: 'x' } })),
                    ).rejects.toThrow(/Missing permissions on model tenant/);
                });
            } finally {
                debug.mockRestore();
            }
        });

        test('`_count` in a select is passed through without filtering', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, select: { id: true, _count: { select: { tasks: true } } } }),
                );
                expect(row._count.tasks).toBe(3);
            });
        });

        test('belongsTo include whose target has no rule for the role → 403', async () => {
            const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
            try {
                await withConfig({ Task: { AUDITOR: { findMany: 'ALL' } } }, async (prisma) => {
                    await expect(
                        asUser(AUDITOR, () => prisma.model.task.findMany({ include: { project: true } })),
                    ).rejects.toThrow(/Missing permissions on model Project/);
                });
            } finally {
                debug.mockRestore();
            }
        });

        test('belongsTo include whose target is exposed adds no condition', async () => {
            await withConfig({ Project: { USER: { findFirst: { conditions: { ownerId: $UID } } } } }, async (prisma) => {
                // bob owns no p1; with Project exposed the include does not gate t1.
                const row: any = await asUser(
                    s.users.bob,
                    () => prisma.model.task.findFirst({ where: { id: s.tasks.t1.id }, include: { project: true } }),
                    ['project'],
                );
                expect(row.project.id).toBe(s.projects.p1.id);
            });
        });

        test("belongsTo include whose target is 'ALL' adds no condition", async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { tenant: true } }),
                );
                expect(row.tenant.id).toBe(s.tenants.T1.id);
            });
        });

        test('hasMany selected as bare `true` with BYPASS_OMISSION is filtered by the related rule', async () => {
            await withConfig({ Task: { USER: { findMany: { conditions: { assigneeId: $UID } } } } }, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    (prisma.model.project.findFirst as any)(
                        { where: { id: s.projects.p1.id }, select: { id: true, tasks: true } },
                        { BYPASS_OMISSION: true },
                    ),
                );
                // p1 holds t1 (alice), t2 (bob), t3 (none) — only alice's task is readable.
                expect(ids(row.tasks)).toEqual(ids([s.tasks.t1]));
            });
        });

        test('permission conditions with a `null` value are passed through', async () => {
            await withConfig({ Task: { USER: { findMany: { conditions: { assigneeId: null } } } } }, async (prisma) => {
                const rows: any = await asUser(s.users.bob, () => prisma.model.task.findMany({}));
                expect(ids(rows)).toEqual(ids([s.tasks.t3]));
            });
        });
    });

    describe('relation scoping (filters, nested selections, orderBy, _count)', () => {
        test('nested `include` below a to-one under BYPASS_OMISSION is filtered', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    (prisma.model.comment.findFirst as any)(
                        { where: { id: s.comments.c2.id }, include: { task: { include: { comments: true } } } },
                        { BYPASS_OMISSION: true },
                    ),
                );
                expect(ids(row.task.comments)).toEqual([s.comments.c2.id]);
            });
        });

        test('orderBy below a fully readable to-one still applies the deeper rule', async () => {
            await withConfig({ Project: { USER: { findFirst: 'ALL', findMany: 'ALL' } } }, async (prisma) => {
                const rows = await asUser(s.users.bob, () =>
                    prisma.model.task.findMany({ orderBy: { project: { owner: { email: 'asc' } } }, select: { id: true } }),
                );
                // Every project is readable; owners of p1/p2 (alice) and p4 (dave) are not.
                expect(ids(rows)).toEqual([s.tasks.t4.id]);
            });
        });

        test('relation filter outside any exposure context', async () => {
            await withConfig({ Project: { GUEST: { findMany: 'ALL' } } }, async (prisma) => {
                // No RequestContext / CorePrismaContext at all → GUEST; Task has no GUEST rule.
                await expect(prisma.model.project.findMany({ where: { tasks: { some: {} } } })).rejects.toThrow(
                    /Cannot filter by 'project.tasks'/,
                );
            });
        });

        test('`_count` entries set to false and `_count: false` are left as is', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.bob, () =>
                    prisma.model.project.findFirst({
                        where: { id: s.projects.p1.id },
                        select: { id: true, _count: { select: { tasks: true, members: false } } },
                    }),
                );
                expect(row._count).toEqual({ tasks: 3 });
                // Defensive guards: no `select` map / a key that isn't a relation.
                expect((prisma as any).applyCountConditions('project', 'USER', false, s.users.bob)).toBe(false);
                expect((prisma as any).applyCountConditions('project', 'USER', { select: { name: true } }, s.users.bob)).toEqual({
                    select: { name: true },
                });
            });
        });

        test('defensive guards on non-object clauses', async () => {
            await withConfig({}, async (prisma) => {
                const p: any = prisma;
                expect(p.scopeRelationFilters('task', 'USER', null, s.users.bob)).toBeNull();
                expect(p.nullSafeConditions('task', null)).toBeNull();
                expect(p.orderByRelationConditions('task', 'USER', [null, 'id'], s.users.bob)).toEqual([]);
            });
        });
    });

    describe('enforceCreateConditions', () => {
        test('create without any CorePrismaContext store (GUEST) is enforced', async () => {
            await withConfig({ Tag: { GUEST: { create: 'ALL' } } }, async (prisma) => {
                const tag: any = await prisma.model.tag.create({ data: { name: 'cov-guest-tag' } });
                await raw.tag.delete({ where: { id: tag.id } });
                expect(tag.name).toBe('cov-guest-tag');
            });
        });

        test('an exposed model skips create enforcement', async () => {
            await withConfig({}, async (prisma) => {
                // USER has no Tag create rule; exposure allows it.
                const tag: any = await asUser(s.users.alice, () => prisma.model.tag.create({ data: { name: 'cov-exposed-tag' } }), ['tag']);
                await raw.tag.delete({ where: { id: tag.id } });
                expect(tag.name).toBe('cov-exposed-tag');
            });
        });

        test('role with no rules on the model → create denied', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(AUDITOR, () => prisma.model.tag.create({ data: { name: 'cov-x' } })),
                ).rejects.toThrow(/No permissions defined for role AUDITOR on model 'tag'/);
            });
        });

        test('role with rules but no create → create denied', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(s.users.alice, () => prisma.model.tenant.create({ data: { name: 'cov-x' } })),
                ).rejects.toThrow(/has no 'create' permission on model 'tenant'/);
            });
        });

        test("createMany falls back to the 'create' rule", async () => {
            await withConfig({}, async (prisma) => {
                const res: any = await asUser(s.users.root, () =>
                    prisma.model.tag.createMany({ data: [{ name: 'cov-many-1' }, { name: 'cov-many-2' }] }),
                );
                await raw.tag.deleteMany({ where: { name: { in: ['cov-many-1', 'cov-many-2'] } } });
                expect(res.count).toBe(2);
            });
        });

        test('a create rule without conditions allows the insert', async () => {
            await withConfig({ Tag: { USER: { create: {} } } }, async (prisma) => {
                const tag: any = await asUser(s.users.alice, () => prisma.model.tag.create({ data: { name: 'cov-nocond' } }));
                await raw.tag.delete({ where: { id: tag.id } });
                expect(tag.name).toBe('cov-nocond');
            });
        });

        test('array-form conditions are ANDed; array data is checked row by row', async () => {
            await withConfig(
                { Tag: { USER: { create: { conditions: [{ name: { in: ['cov-arr-1', 'cov-arr-2'] } }] } } } },
                async (prisma) => {
                    const res: any = await asUser(s.users.alice, () =>
                        prisma.model.tag.createMany({ data: [{ name: 'cov-arr-1' }, { name: 'cov-arr-2' }] }),
                    );
                    await raw.tag.deleteMany({ where: { name: { in: ['cov-arr-1', 'cov-arr-2'] } } });
                    expect(res.count).toBe(2);

                    await expect(
                        asUser(s.users.alice, () => prisma.model.tag.createMany({ data: [{ name: 'cov-arr-1' }, { name: 'nope' }] })),
                    ).rejects.toThrow(/does not satisfy the 'createMany' permission conditions/);
                },
            );
        });

        test('missing data / null rows are evaluated as empty rows', async () => {
            await withConfig({ Tag: { USER: { create: { conditions: { name: 'cov-only' } } } } }, async (prisma) => {
                await expect(asUser(s.users.alice, () => prisma.model.tag.create({} as any))).rejects.toThrow(
                    /does not satisfy the 'create' permission conditions/,
                );
                await expect(asUser(s.users.alice, () => prisma.model.tag.createMany({ data: [null] } as any))).rejects.toThrow(
                    /does not satisfy the 'createMany' permission conditions/,
                );
            });
        });
    });

    describe('enforceNestedWrites', () => {
        // Branch-level calls: the proxy reaches these only with payloads Prisma itself rejects.
        test('defensive guards: non-object data, null rows and null relation ops are skipped', async () => {
            await withConfig({}, async (prisma) => {
                const p = prisma as any;
                await expect(p.enforceNestedWrites('Task', undefined, s.users.alice, 'USER')).resolves.toBeUndefined();
                await expect(p.enforceNestedWrites('Task', [null, { title: 'x' }], s.users.alice, 'USER')).resolves.toBeUndefined();
                await expect(p.enforceNestedWrites('Task', { assignee: null }, s.users.alice, 'USER')).resolves.toBeUndefined();
            });
        });

        test('the trusted back-reference FK is not re-authorized', async () => {
            // Project has no USER connect rule here, so authorizing projectId would throw.
            await withConfig({ Project: { USER: { connect: undefined } } }, async (prisma) => {
                await expect(
                    (prisma as any).enforceNestedWrites('Task', { projectId: s.projects.p4.id }, s.users.alice, 'USER', 'projectId'),
                ).resolves.toBeUndefined();
            });
        });

        test('a null FK on update is not authorized as a connect', async () => {
            await withConfig({}, async (prisma) => {
                const res: any = await asUser(s.users.root, () =>
                    prisma.model.task.updateMany({ where: { id: s.tasks.t3.id }, data: { assigneeId: null } }),
                );
                expect(res.count).toBe(1);
            });
        });
    });

    describe('foreignKeyColumn / backReferenceFk', () => {
        test('unknown models resolve to nothing', async () => {
            await withConfig({}, async (prisma) => {
                expect((prisma as any).foreignKeyColumn('Nope', 'x')).toBeNull();
                expect((prisma as any).backReferenceFk('Nope', 'Project')).toBeUndefined();
            });
        });

        test('without a relation name, a single candidate is used', async () => {
            await withConfig({}, async (prisma) => {
                expect((prisma as any).backReferenceFk('Task', 'Project', undefined)).toBe('projectId');
                expect((prisma as any).backReferenceFk('Task', 'User', undefined)).toBeUndefined();
            });
        });
    });

    describe('assertConnectAllowed', () => {
        test('no CorePrismaContext store: evaluated against the raw client', async () => {
            await withConfig({ Project: { GUEST: { connect: { conditions: { ownerId: s.users.alice.id } } } } }, async (prisma) => {
                await expect(
                    (prisma as any).assertConnectAllowed('Task', 'project', 'Project', { id: s.projects.p1.id }, {}, 'GUEST'),
                ).resolves.toBeUndefined();
            });
        });

        test('an exposed target skips the check', async () => {
            await withConfig({}, async (prisma) => {
                await expect(
                    asUser(
                        AUDITOR,
                        () => (prisma as any).assertConnectAllowed('Task', 'project', 'Project', { id: 1 }, AUDITOR, 'AUDITOR'),
                        ['project'],
                    ),
                ).resolves.toBeUndefined();
            });
        });

        test('array-form conditions; a missing target `where` matches any candidate', async () => {
            await withConfig({ Project: { USER: { connect: { conditions: [{ ownerId: $UID }] } } } }, async (prisma) => {
                const p = prisma as any;
                await expect(
                    asUser(s.users.alice, () => p.assertConnectAllowed('Task', 'project', 'Project', { id: s.projects.p1.id }, s.users.alice, 'USER')),
                ).resolves.toBeUndefined();
                await expect(
                    asUser(s.users.alice, () => p.assertConnectAllowed('Task', 'project', 'Project', undefined, s.users.alice, 'USER')),
                ).resolves.toBeUndefined();
                await expect(
                    asUser(s.users.alice, () => p.assertConnectAllowed('Task', 'project', 'Project', { id: s.projects.p4.id }, s.users.alice, 'USER')),
                ).rejects.toThrow(/does not satisfy the 'connect' permission/);
            });
        });
    });

    describe('warnIfCreatedRowNotFindable', () => {
        test('skips rows without an id, roles without a find rule, and unconditional rules', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                await withConfig(
                    { Tag: { AUDITOR: { findMany: { conditions: { name: 'x' } } } }, Tenant: { AUDITOR: { findFirst: {} } } },
                    async (prisma) => {
                        const p = prisma as any;
                        await p.warnIfCreatedRowNotFindable('tag', 'USER', null);
                        await p.warnIfCreatedRowNotFindable('tag', 'USER', {});
                        await p.warnIfCreatedRowNotFindable('tag', 'USER', { id: null });
                        await p.warnIfCreatedRowNotFindable('tag', 'GUEST', { id: 1 }); // no rules for the role
                        await p.warnIfCreatedRowNotFindable('tenant', 'USER', { id: 1 }); // 'ALL'
                        await p.warnIfCreatedRowNotFindable('tenant', 'AUDITOR', { id: 1 }); // no conditions
                    },
                );
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });

        test('warns only when the row is not findable; falls back to findMany rule', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                await withConfig({ Tag: { AUDITOR: { findMany: { conditions: { name: 'urgent' } } } } }, async (prisma) => {
                    const p = prisma as any;
                    await asUser(AUDITOR, () => p.warnIfCreatedRowNotFindable('tag', 'AUDITOR', { id: s.tags.urgent.id }));
                    expect(warn).not.toHaveBeenCalled();
                    await asUser(AUDITOR, () => p.warnIfCreatedRowNotFindable('tag', 'AUDITOR', { id: s.tags.secret.id }));
                    expect(warn).toHaveBeenCalledTimes(1);
                });
            } finally {
                warn.mockRestore();
            }
        });

        test('errors inside the diagnostic are swallowed', async () => {
            const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
            try {
                await withConfig({}, async (prisma) => {
                    // 'projectmember' has rules after normalisation but is not a client key → TypeError, caught.
                    await expect(
                        asUser(s.users.alice, () => (prisma as any).warnIfCreatedRowNotFindable('projectmember', 'USER', { id: 1 })),
                    ).resolves.toBeUndefined();
                });
                expect(warn).not.toHaveBeenCalled();
            } finally {
                warn.mockRestore();
            }
        });
    });

    describe('resolveConnectForeignKeys', () => {
        test('passes through non-object rows and skips relations it cannot map', async () => {
            await withConfig({}, async (prisma) => {
                const p = prisma as any;
                expect(p.resolveConnectForeignKeys('Task', null)).toBeNull();
                // Back side of a 1:1 (no FK columns on this model).
                const profileRow = { profile: { create: { bio: 'x' } } };
                expect(p.resolveConnectForeignKeys('User', profileRow)).toBe(profileRow);
                // Explicit scalar wins over connect.
                const both = { projectId: 1, project: { connect: { id: 2 } } };
                expect(p.resolveConnectForeignKeys('Task', both)).toBe(both);
                // Not a connect by the referenced column.
                const nested = { project: { create: { name: 'x' } } };
                expect(p.resolveConnectForeignKeys('Task', nested)).toBe(nested);
                // Connect by the referenced column is surfaced as the scalar FK.
                expect(p.resolveConnectForeignKeys('Task', { project: { connect: { id: 7 } } })).toEqual({
                    project: { connect: { id: 7 } },
                    projectId: 7,
                });
            });
        });
    });

    describe('matchesCreateConditions', () => {
        test('AND / OR / NOT in array and object form', async () => {
            await withConfig({}, async (prisma) => {
                const m = (cond: any, row: any, trustedFk?: string) =>
                    (prisma as any).matchesCreateConditions(cond, row, 'Tag', trustedFk);
                const row = { name: 'a' };
                await expect(m({ AND: [{ name: 'a' }] }, row)).resolves.toBe(true);
                await expect(m({ AND: [{ name: 'b' }] }, row)).resolves.toBe(false);
                await expect(m({ AND: { name: 'a' } }, row)).resolves.toBe(true);
                await expect(m({ OR: [{ name: 'b' }, { name: 'a' }] }, row)).resolves.toBe(true);
                await expect(m({ OR: [{ name: 'b' }, { name: 'c' }] }, row)).resolves.toBe(false);
                await expect(m({ OR: { name: 'a' } }, row)).resolves.toBe(true);
                await expect(m({ NOT: [{ name: 'a' }] }, row)).resolves.toBe(false);
                await expect(m({ NOT: { name: 'b' } }, row)).resolves.toBe(true);
            });
        });

        test('trusted FK and relation keys are skipped', async () => {
            await withConfig({}, async (prisma) => {
                const p = prisma as any;
                await expect(p.matchesCreateConditions({ projectId: 999 }, {}, 'Task', 'projectId')).resolves.toBe(true);
                await expect(p.matchesCreateConditions({ project: { ownerId: 1 } }, {}, 'Task')).resolves.toBe(true);
            });
        });
    });

    describe('matchesCreateScalar', () => {
        test('null, literal and every supported operator', async () => {
            await withConfig({}, async (prisma) => {
                const m = (actual: any, cond: any) => (prisma as any).matchesCreateScalar(actual, cond, 'f', 'Tag');
                expect(m(null, null)).toBe(true);
                expect(m(undefined, null)).toBe(true);
                expect(m('x', null)).toBe(false);
                const d = new Date(0);
                expect(m(d, d)).toBe(true);
                expect(m(1, { equals: 1 })).toBe(true);
                expect(m(2, { equals: 1 })).toBe(false);
                expect(m(2, { not: 1 })).toBe(true);
                expect(m(1, { not: 1 })).toBe(false);
                expect(m(1, { in: [1, 2] })).toBe(true);
                expect(m(3, { in: [1, 2] })).toBe(false);
                expect(m(1, { in: 1 })).toBe(false);
                expect(m(3, { notIn: [1, 2] })).toBe(true);
                expect(m(1, { notIn: [1, 2] })).toBe(false);
                expect(m(1, { notIn: 1 })).toBe(true);
                expect(m(1, { lt: 2 })).toBe(true);
                expect(m(2, { lt: 2 })).toBe(false);
                expect(m(2, { lte: 2 })).toBe(true);
                expect(m(3, { lte: 2 })).toBe(false);
                expect(m(3, { gt: 2 })).toBe(true);
                expect(m(2, { gt: 2 })).toBe(false);
                expect(m(2, { gte: 2 })).toBe(true);
                expect(m(1, { gte: 2 })).toBe(false);
                expect(() => m('x', { contains: 'x' })).toThrow(/unsupported operator 'contains'/);
            });
        });
    });

    describe('_buildConditions', () => {
        test('no conditions → empty where', () => {
            expect(PrismaService._buildConditions(undefined as any, { id: 1 })).toEqual({});
        });
    });

    describe('getScalarFields', () => {
        test('known and unknown models', async () => {
            await withConfig({}, async (prisma) => {
                expect(prisma.getScalarFields('Project')).toContain('secretApiKey');
                expect(prisma.getScalarFields('Nope')).toEqual([]);
            });
        });
    });

    describe('getRoleRestrictedFields', () => {
        test('known and unknown models', async () => {
            await withConfig({}, async (prisma) => {
                expect(prisma.getRoleRestrictedFields('Project')).toEqual(['secretApiKey', 'budget']);
                expect(prisma.getRoleRestrictedFields('Nope')).toEqual([]);
            });
        });
    });

    describe('getFieldsToOmit', () => {
        test('defensive guard: unknown model omits nothing', async () => {
            await withConfig({}, async (prisma) => {
                expect((prisma as any).getFieldsToOmit('Nope', 'USER')).toEqual([]);
            });
        });
    });

    describe('buildSelectFields', () => {
        test('defensive guard: unknown model → empty select', async () => {
            await withConfig({}, async (prisma) => {
                expect((prisma as any).buildSelectFields('Nope', [], null, null, 'USER')).toEqual({});
            });
        });

        test('nested include with a `select` that mixes scalars, relations and _count', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.task.findFirst({
                        where: { id: s.tasks.t1.id },
                        include: {
                            project: { select: { name: true, owner: true, _count: { select: { tasks: true } } } },
                        },
                    }),
                );
                expect(row.project.name).toBe('Alpha');
                expect(row.project.owner.id).toBe(s.users.alice.id);
                expect(row.project.owner.password).toBeUndefined();
                expect(row.project._count.tasks).toBe(3);
            });
        });

        test('nested include with both `select` and `include`: the `include` relations are dropped', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.task.findFirst({
                        where: { id: s.tasks.t1.id },
                        include: { project: { select: { name: true, owner: true }, include: { tags: true } } as any },
                    }),
                );
                expect(row.project.owner.id).toBe(s.users.alice.id);
                expect(row.project.tags).toBeUndefined();
            });
        });

        test('include of a non-relation key is dropped', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, include: { name: true } as any }),
                );
                expect(row.id).toBe(s.projects.p1.id);
                expect(row.secretApiKey).toBeUndefined();
            });
        });

        test('include `_count` with a select: the parent model\'s omitted fields are removed from it', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findFirst({
                        where: { id: s.projects.p1.id },
                        include: { _count: { select: { tasks: true, secretApiKey: true } } } as any,
                    }),
                );
                expect(row._count).toEqual({ tasks: 3 });
            });
        });

        test('include `_count: true` is dropped from the result', async () => {
            await withConfig({}, async (prisma) => {
                const row: any = await asUser(s.users.alice, () =>
                    prisma.model.project.findFirst({ where: { id: s.projects.p1.id }, include: { _count: true } }),
                );
                expect(row.id).toBe(s.projects.p1.id);
                expect(row._count).toBeUndefined();
            });
        });
    });

    describe('getRelation', () => {
        test('throws for an unknown relation when asked to', async () => {
            await withConfig({}, async (prisma) => {
                expect(() => prisma.getRelation('Project', 'nope', true)).toThrow(/Relation key nope not found in model project/);
                expect(prisma.getRelation('Project', 'nope')).toBeUndefined();
            });
        });
    });

    describe('selectPermission', () => {
        test('find* falls back to findFirst when findMany is absent', async () => {
            const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
            try {
                await withConfig({ Project: { AUDITOR: { findFirst: 'ALL' } } }, async (prisma) => {
                    const rows: any = await asUser(AUDITOR, () => prisma.model.project.findMany({}));
                    expect(rows.length).toBe(4);
                });
            } finally {
                debug.mockRestore();
            }
        });

        test('count without any find rule → 403', async () => {
            const debug = jest.spyOn(console, 'debug').mockImplementation(() => undefined);
            try {
                await withConfig({ Tag: { AUDITOR: { updateMany: 'ALL' } } }, async (prisma) => {
                    await expect(asUser(AUDITOR, () => prisma.model.tag.count({}))).rejects.toThrow(
                        /Missing permissions on model tag/,
                    );
                });
            } finally {
                debug.mockRestore();
            }
        });
    });

    test('buildAbacModule boots a standalone service', async () => {
        const { prisma, close } = await buildAbacModule(abacPermissions);
        try {
            expect(prisma).toBeInstanceOf(PrismaService);
        } finally {
            await close();
        }
    });
});
