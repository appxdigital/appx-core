/**
 * Probe: does field omission (@Role) survive a NESTED select?
 *
 * The GraphQL generic resolver turns the query into an explicit nested
 * `select` (`new PrismaSelect(info).value`) and calls the proxied client. This
 * test drives the proxy directly with the same shape to confirm/kill the
 * hypothesis that `applyFieldOmission` only strips top-level fields and leaves
 * @Role-restricted fields on NESTED relations exposed.
 *
 * secretApiKey (Project) and billingInfo (UserProfile) are `/// @Role(ADMIN)`;
 * password (User) is `/// @Role(none)`.
 */
import { seedAbac, resetAbac, SeededAbac } from './seed';
import { withConfig, newRawClient, asUser } from './helpers';

describe('field omission under nested select (GraphQL path)', () => {
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

    test('CONTROL — top-level @Role(ADMIN) field is omitted for USER', async () => {
        await withConfig({}, async (prisma) => {
            const row: any = await asUser(s.users.alice, () =>
                prisma.model.project.findFirst({
                    where: { id: s.projects.p1.id },
                    select: { id: true, name: true, secretApiKey: true },
                }),
            );
            expect(row?.id).toBe(s.projects.p1.id);
            expect(row.secretApiKey).toBeUndefined();
        });
    });

    test('CONTROL — ADMIN sees the top-level @Role(ADMIN) field', async () => {
        await withConfig({}, async (prisma) => {
            const row: any = await asUser(s.users.root, () =>
                prisma.model.project.findFirst({
                    where: { id: s.projects.p1.id },
                    select: { id: true, secretApiKey: true },
                }),
            );
            expect(row.secretApiKey).toBe('sk-A');
        });
    });

    test('NESTED hasMany — USER selecting a related @Role(ADMIN) field', async () => {
        await withConfig({}, async (prisma) => {
            // alice (USER) reads herself; ownedProjects (hasMany) = p1, p2.
            // Select the ADMIN-only secretApiKey on the nested projects.
            const row: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({
                    where: { id: s.users.alice.id },
                    select: {
                        id: true,
                        ownedProjects: { select: { id: true, secretApiKey: true } },
                    },
                }),
            );
            expect(row?.id).toBe(s.users.alice.id);
            const projects = row.ownedProjects as any[];
            expect(projects.length).toBeGreaterThan(0);
            // Field omission recurses into nested relation selects: the @Role(ADMIN)
            // field must NOT be returned to a USER on the nested projects.
            expect(projects.every((p) => p.secretApiKey === undefined)).toBe(true);
        });
    });

    test('NESTED to-one (readable) — USER selecting related @Role(none) password', async () => {
        await withConfig({}, async (prisma) => {
            // t2.reviewer = alice (self → readable, so the parent survives gating).
            const row: any = await asUser(s.users.alice, () =>
                prisma.model.task.findFirst({
                    where: { id: s.tasks.t2.id },
                    select: {
                        id: true,
                        reviewer: { select: { id: true, password: true } },
                    },
                }),
            );
            expect(row?.reviewer?.id).toBe(s.users.alice.id);
            // Nested @Role(none) field must be omitted.
            expect(row.reviewer.password).toBeUndefined();
        });
    });

    test('NESTED include — related @Role(ADMIN) field omitted for USER', async () => {
        await withConfig({}, async (prisma) => {
            const row: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({
                    where: { id: s.users.alice.id },
                    include: { ownedProjects: true },
                }),
            );
            const projects = row.ownedProjects as any[];
            expect(projects.length).toBeGreaterThan(0);
            expect(projects.every((p) => p.secretApiKey === undefined)).toBe(true);
            expect(projects.every((p) => p.name !== undefined)).toBe(true); // non-restricted field survives
        });
    });

    test('DEEP nested select (2 levels) — omitted at every level', async () => {
        await withConfig({}, async (prisma) => {
            // User -> ownedProjects (secretApiKey @Role(ADMIN)) -> owner (password @Role(none)).
            const row: any = await asUser(s.users.alice, () =>
                prisma.model.user.findFirst({
                    where: { id: s.users.alice.id },
                    select: {
                        id: true,
                        ownedProjects: {
                            select: {
                                id: true,
                                secretApiKey: true,
                                owner: { select: { id: true, password: true } },
                            },
                        },
                    },
                }),
            );
            const projects = row.ownedProjects as any[];
            expect(projects.length).toBeGreaterThan(0);
            expect(projects.every((p) => p.secretApiKey === undefined)).toBe(true);
            expect(projects.every((p) => p.owner && p.owner.password === undefined)).toBe(true);
            expect(projects.every((p) => p.owner.id === s.users.alice.id)).toBe(true);
        });
    });
});
