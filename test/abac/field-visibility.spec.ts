/**
 * Row-conditional field visibility (`fields.<column>.visibleOnlyWhen`): a listed
 * column is returned only on rows matching its condition, at every depth.
 * Alice (USER) reads herself and her reports Bob and Carol; she owns Alpha and
 * Beta and is a member of Gamma (owned by Bob).
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';

const $UID = '$USER_ID';

describe('field visibility — read path', () => {
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

    const ownEmail = { User: { USER: { fields: { email: { visibleOnlyWhen: { id: $UID } } } } } };
    const ownerStatus = { Project: { USER: { fields: { status: { visibleOnlyWhen: { ownerId: $UID } } } } } };
    const byId = (rows: any[]) => Object.fromEntries(rows.map((r) => [r.id, r]));

    test('findMany: the column is present on matching rows only', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const rows: any[] = await asUser(s.users.alice, () => prisma.model.user.findMany({ orderBy: { id: 'asc' } }));
            const users = byId(rows);
            expect(Object.keys(users).map(Number)).toEqual([s.users.alice.id, s.users.bob.id, s.users.carol.id]);
            expect(users[s.users.alice.id].email).toBe('alice@t.io');
            expect(users[s.users.bob.id]).not.toHaveProperty('email');
            expect(users[s.users.carol.id]).not.toHaveProperty('email');
            expect(users[s.users.bob.id].tenantId).toBe(s.users.bob.tenantId);
        });
    });

    test('findFirst: own row has the column, another readable row does not', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const own: any = await asUser(s.users.alice, () => prisma.model.user.findFirst({ where: { id: s.users.alice.id } }));
            const other: any = await asUser(s.users.alice, () => prisma.model.user.findFirst({ where: { id: s.users.bob.id } }));
            expect(own.email).toBe('alice@t.io');
            expect(other.id).toBe(s.users.bob.id);
            expect(other).not.toHaveProperty('email');
        });
    });

    test('a condition column the caller did not select is read for the check and not returned', async () => {
        await withConfig(ownerStatus, async (prisma) => {
            const rows: any[] = await asUser(s.users.alice, () =>
                prisma.model.project.findMany({ select: { name: true, status: true }, orderBy: { name: 'asc' } }),
            );
            expect(rows).toEqual([{ name: 'Alpha', status: 'active' }, { name: 'Beta', status: 'active' }, { name: 'Gamma' }]);
        });
    });

    test('a condition column the caller selected is kept', async () => {
        await withConfig(ownerStatus, async (prisma) => {
            const row: any = await asUser(s.users.alice, () =>
                prisma.model.project.findFirst({ where: { id: s.projects.p3.id }, select: { ownerId: true, status: true } }),
            );
            expect(row).toEqual({ ownerId: s.users.bob.id });
        });
    });

    test('nested to-many and to-one relations are masked per row', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const me: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({ where: { id: s.users.alice.id }, include: { reports: true } }),
            );
            expect(me.email).toBe('alice@t.io');
            expect(me.reports).toHaveLength(2);
            for (const r of me.reports) expect(r).not.toHaveProperty('email');

            const projects: any[] = await asUser(s.users.alice, () =>
                prisma.model.project.findMany({ select: { name: true, owner: { select: { email: true } } }, orderBy: { name: 'asc' } }),
            );
            expect(projects).toEqual([
                { name: 'Alpha', owner: { email: 'alice@t.io' } },
                { name: 'Beta', owner: { email: 'alice@t.io' } },
                { name: 'Gamma', owner: {} },
            ]);
        });
    });

    test('a null to-one relation is left as is', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const me: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({ where: { id: s.users.alice.id }, select: { email: true, manager: { select: { email: true } } } }),
            );
            expect(me).toEqual({ email: 'alice@t.io', manager: null });
        });
    });

    test('no row, and a relation selected as false, are left as is', async () => {
        await withConfig(ownEmail, async (prisma) => {
            expect(await asUser(s.users.alice, () => prisma.model.user.findFirst({ where: { id: s.users.dave.id } }))).toBeNull();
            const me: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({ where: { id: s.users.alice.id }, select: { email: true, reports: false } }),
            );
            expect(me).toEqual({ email: 'alice@t.io' });
        });
    });

    test('rules on several models apply in one query', async () => {
        await withConfig({ ...ownEmail, ...ownerStatus }, async (prisma) => {
            const rows: any[] = await asUser(s.users.alice, () =>
                prisma.model.project.findMany({ select: { name: true, status: true, owner: { select: { id: true, email: true } } }, orderBy: { name: 'asc' } }),
            );
            expect(rows[2]).toEqual({ name: 'Gamma', owner: { id: s.users.bob.id } });
            expect(rows[0]).toEqual({ name: 'Alpha', status: 'active', owner: { id: s.users.alice.id, email: 'alice@t.io' } });
        });
    });

    test('conditions combine with AND / OR / NOT and operators', async () => {
        await withConfig(
            { User: { USER: { fields: { email: { visibleOnlyWhen: { OR: [{ id: $UID }, { AND: [{ id: { in: [s.users.bob.id] } }, { NOT: { managerId: null } }] }] } } } } } },
            async (prisma) => {
                const users = byId(await asUser(s.users.alice, () => prisma.model.user.findMany({ select: { id: true, email: true } })));
                expect(users[s.users.alice.id].email).toBe('alice@t.io');
                expect(users[s.users.bob.id].email).toBe('bob@t.io');
                expect(users[s.users.carol.id]).not.toHaveProperty('email');
            },
        );
    });

    test('every rule is judged on the row as read, before any column is removed', async () => {
        // `id` is itself conditional and is also what the email rule reads.
        await withConfig(
            { User: { USER: { fields: { id: { visibleOnlyWhen: { id: $UID } }, email: { visibleOnlyWhen: { id: $UID } } } } } },
            async (prisma) => {
                const rows: any[] = await asUser(s.users.alice, () => prisma.model.user.findMany({ select: { id: true, email: true, tenantId: true } }));
                expect(rows).toHaveLength(3);
                expect(rows.filter((r) => 'id' in r)).toEqual([{ id: s.users.alice.id, email: 'alice@t.io', tenantId: s.users.alice.tenantId }]);
                expect(rows.filter((r) => !('id' in r)).every((r) => !('email' in r))).toBe(true);
            },
        );
    });

    test('the row a create returns is masked too', async () => {
        await withConfig({ Project: { USER: { create: 'ALL', fields: ownerStatus.Project.USER.fields } } }, async (prisma) => {
            try {
                const own: any = await asUser(s.users.alice, () => prisma.model.project.create({ data: { name: 'FV-own', ownerId: s.users.alice.id, status: 'x' } }));
                const other: any = await asUser(s.users.alice, () =>
                    prisma.model.project.create({ data: { name: 'FV-other', ownerId: s.users.bob.id, status: 'x' }, select: { name: true, status: true } }),
                );
                expect(own.status).toBe('x');
                expect(other).toEqual({ name: 'FV-other' });
            } finally {
                await raw.project.deleteMany({ where: { name: { startsWith: 'FV-' } } });
            }
        });
    });

    test('@Role applies first: a rule never shows a column outside the role list', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        try {
            await withConfig({ Project: { USER: { fields: { secretApiKey: { visibleOnlyWhen: { ownerId: $UID } } } } } }, async (prisma) => {
                const row: any = await asUser(s.users.alice, () => prisma.model.project.findFirst({ where: { id: s.projects.p1.id } }));
                expect(row.name).toBe('Alpha');
                expect(row).not.toHaveProperty('secretApiKey');
            });
        } finally {
            warn.mockRestore();
        }
    });

    test('roles without a rule, exposed models and BYPASS_OMISSION see the column on every row', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const admin: any[] = await asUser(s.users.root, () => prisma.model.user.findMany({ where: { id: s.users.bob.id } }));
            expect(admin[0].email).toBe('bob@t.io');

            const exposed: any = await asUser(s.users.alice, () => prisma.model.user.findFirst({ where: { id: s.users.bob.id } }), ['User']);
            expect(exposed.email).toBe('bob@t.io');

            const exposedNested: any = await asUser(
                s.users.alice,
                () => prisma.model.project.findFirst({ where: { id: s.projects.p3.id }, select: { owner: { select: { email: true } } } }),
                ['User'],
            );
            expect(exposedNested.owner.email).toBe('bob@t.io');

            const bypass: any = await asUser(s.users.alice, () =>
                (prisma.model.user.findFirst as any)({ where: { id: s.users.bob.id } }, { BYPASS_OMISSION: true }),
            );
            expect(bypass.email).toBe('bob@t.io');
        });
    });
});

describe('field visibility — filters and sorting', () => {
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

    const ownEmail = { User: { USER: { fields: { email: { visibleOnlyWhen: { id: $UID } } } } } };
    const ids = (rows: any[]) => rows.map((r) => r.id).sort((a, b) => a - b);

    test('a where on the column only matches rows where it is visible', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const find = (where: any) => asUser(s.users.alice, () => prisma.model.user.findMany({ where, select: { id: true } }));
            expect(ids(await find({ email: 'bob@t.io' }))).toEqual([]);
            expect(ids(await find({ email: { startsWith: 'b' } }))).toEqual([]);
            expect(ids(await find({ OR: [{ email: 'bob@t.io' }, { email: 'alice@t.io' }] }))).toEqual([s.users.alice.id]);
            expect(ids(await find({ email: { in: ['alice@t.io', 'bob@t.io'] }, tenantId: s.users.alice.tenantId }))).toEqual([s.users.alice.id]);
            expect(await asUser(s.users.alice, () => prisma.model.user.findUnique({ where: { email: 'bob@t.io' } }))).toBeNull();
        });
    });

    test('a negated where does not tell hidden values apart', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const rows: any[] = await asUser(s.users.alice, () => prisma.model.user.findMany({ where: { NOT: { email: 'bob@t.io' } }, select: { id: true } }));
            expect(ids(rows)).toEqual([s.users.alice.id, s.users.bob.id, s.users.carol.id]);
        });
    });

    test('a condition on a nullable column stays strictly true or false under NOT', async () => {
        // Alice's managerId is NULL: her email is hidden from her under this rule.
        await withConfig({ User: { USER: { fields: { email: { visibleOnlyWhen: { managerId: $UID } } } } } }, async (prisma) => {
            const find = (where: any) => asUser(s.users.alice, () => prisma.model.user.findMany({ where, select: { id: true } }));
            expect(ids(await find({ NOT: { email: 'alice@t.io' } }))).toEqual(ids(await find({ NOT: { email: 'nobody@t.io' } })));
            expect(ids(await find({ NOT: { email: 'alice@t.io' } }))).toContain(s.users.alice.id);
        });
    });

    test('presence checks stay allowed', async () => {
        // Seeded users have no name; the check is not narrowed to visible rows.
        await withConfig({ User: { USER: { fields: { name: { visibleOnlyWhen: { id: $UID } } } } } }, async (prisma) => {
            const rows: any[] = await asUser(s.users.alice, () => prisma.model.user.findMany({ where: { name: null }, select: { id: true } }));
            expect(ids(rows)).toEqual([s.users.alice.id, s.users.bob.id, s.users.carol.id]);
            const unset: any[] = await asUser(s.users.alice, () => prisma.model.user.findMany({ where: { name: undefined }, select: { id: true } }));
            expect(ids(unset)).toEqual([s.users.alice.id, s.users.bob.id, s.users.carol.id]);
        });
    });

    test('relation filters and nested selections are scoped the same way', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const byOwner = (email: string) =>
                asUser(s.users.alice, () => prisma.model.project.findMany({ where: { owner: { email } }, select: { id: true } }));
            expect(ids(await byOwner('bob@t.io'))).toEqual([]);
            expect(ids(await byOwner('alice@t.io'))).toEqual([s.projects.p1.id, s.projects.p2.id]);

            const me: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({
                    where: { id: s.users.alice.id, reports: { some: { email: 'bob@t.io' } } },
                    select: { id: true },
                }),
            );
            expect(me).toBeNull();

            const withReports: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({
                    where: { id: s.users.alice.id },
                    select: { reports: { where: { email: 'bob@t.io' }, select: { id: true } } },
                }),
            );
            expect(withReports.reports).toEqual([]);
        });
    });

    test('orderBy and distinct on the column are rejected (403), also through a relation', async () => {
        await withConfig(ownEmail, async (prisma) => {
            await expect(asUser(s.users.alice, () => prisma.model.user.findMany({ orderBy: { email: 'asc' } }))).rejects.toMatchObject({ status: 403 });
            await expect(asUser(s.users.alice, () => prisma.model.user.findMany({ distinct: ['email'] }))).rejects.toMatchObject({ status: 403 });
            await expect(
                asUser(s.users.alice, () => prisma.model.project.findMany({ orderBy: { owner: { email: 'asc' } } })),
            ).rejects.toMatchObject({ status: 403 });
        });
    });

    test('roles without a rule and exposed models filter and sort as before', async () => {
        await withConfig(ownEmail, async (prisma) => {
            const admin: any[] = await asUser(s.users.root, () =>
                prisma.model.user.findMany({ where: { email: 'bob@t.io' }, orderBy: { email: 'asc' }, distinct: ['email'] }),
            );
            expect(ids(admin)).toEqual([s.users.bob.id]);
            const exposed: any[] = await asUser(
                s.users.alice,
                () => prisma.model.user.findMany({ where: { email: 'bob@t.io' }, orderBy: { email: 'asc' }, distinct: ['email'] }),
                ['User'],
            );
            expect(ids(exposed)).toEqual([s.users.bob.id]);
        });
    });
});
