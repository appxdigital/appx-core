/**
 * Static permissions-config validator (Option A). Pure function — no database.
 * Covers each error/warning combination the boot gate relies on.
 */
import { validatePermissionsConfig, SchemaRelations, SchemaColumns } from '../../src/prisma/permissions-validator';

const $UID = '$USER_ID';

// A small schema: Project(owner→User required, members hasMany),
// Task(project→Project required, assignee→User optional).
const relations: SchemaRelations = {
    project: [
        { field: 'owner', model: 'User', referencingColumn: 'ownerId', isRequired: true, kind: 'belongsTo' },
        { field: 'members', model: 'ProjectMember', isRequired: false, kind: 'hasMany' },
    ],
    task: [
        { field: 'project', model: 'Project', referencingColumn: 'projectId', isRequired: true, kind: 'belongsTo' },
        { field: 'assignee', model: 'User', referencingColumn: 'assigneeId', isRequired: false, kind: 'belongsTo' },
    ],
    user: [],
};

const codes = (issues: ReturnType<typeof validatePermissionsConfig>) => issues.map((i) => i.code).sort();

describe('validatePermissionsConfig (Option A)', () => {
    test('no create rule → no FK requirement, no issues', () => {
        const issues = validatePermissionsConfig(
            { Project: { USER: { findMany: 'ALL' } } },
            relations,
        );
        expect(issues).toEqual([]);
    });

    test('required FK target with a connect rule → valid', () => {
        const issues = validatePermissionsConfig(
            {
                Project: { USER: { create: 'ALL' } },
                User: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(issues).toEqual([]);
    });

    test('required FK target with a conditional connect rule → valid', () => {
        const issues = validatePermissionsConfig(
            {
                Project: { USER: { create: 'ALL' } },
                User: { USER: { connect: { conditions: { id: $UID } } } },
            },
            relations,
        );
        expect(issues).toEqual([]);
    });

    test('ERROR: required FK target has no connect rule', () => {
        const issues = validatePermissionsConfig(
            { Project: { USER: { create: 'ALL' } } },
            relations,
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ level: 'error', code: 'missing-connect-required', model: 'Project', role: 'USER' });
        expect(issues[0].message).toMatch(/ownerId.*User/);
    });

    test('ERROR: an optional but settable FK has no connect rule', () => {
        // Task requires project (grant Project.connect); assignee (User) is optional
        // but still settable, so it must have a connect rule too.
        const issues = validatePermissionsConfig(
            {
                Task: { USER: { create: 'ALL' } },
                Project: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(codes(issues)).toEqual(['missing-connect']);
        expect(issues[0]).toMatchObject({ level: 'error', role: 'USER' });
        expect(issues[0].message).toMatch(/assigneeId.*User/);
    });

    test('a @NoWrite FK (fkWritable:false) is not required to have a connect rule', () => {
        const noWriteRelations: SchemaRelations = {
            task: [
                { field: 'project', model: 'Project', referencingColumn: 'projectId', isRequired: true, kind: 'belongsTo' },
                { field: 'assignee', model: 'User', referencingColumn: 'assigneeId', isRequired: false, kind: 'belongsTo', fkWritable: false },
            ],
        };
        const issues = validatePermissionsConfig(
            { Task: { USER: { create: 'ALL' } }, Project: { USER: { connect: 'ALL' } } },
            noWriteRelations,
        );
        expect(issues).toEqual([]);
    });

    test('ERROR: a relation-scoped connect on a @NoWrite (unwritable) field is a contradiction', () => {
        const noWriteRelations: SchemaRelations = {
            task: [
                { field: 'project', model: 'Project', referencingColumn: 'projectId', isRequired: true, kind: 'belongsTo' },
                { field: 'assignee', model: 'User', referencingColumn: 'assigneeId', isRequired: false, kind: 'belongsTo', fkWritable: false },
            ],
        };
        const issues = validatePermissionsConfig(
            {
                Task: { USER: { create: 'ALL', relations: { assignee: { connect: 'ALL' } } } },
                Project: { USER: { connect: 'ALL' } },
            },
            noWriteRelations,
        );
        expect(codes(issues)).toEqual(['connect-on-unwritable']);
        expect(issues[0].message).toMatch(/not writable/);
    });

    describe('a @NoWrite foreign key written server-side by `set`', () => {
        const ownerNoWrite: SchemaRelations = {
            project: [
                { field: 'owner', model: 'User', referencingColumn: 'ownerId', isRequired: true, kind: 'belongsTo', fkWritable: false },
            ],
        };

        test('`set` foreign key with a relation-scoped self-connect → valid', () => {
            const issues = validatePermissionsConfig(
                {
                    Project: {
                        USER: {
                            create: { set: { ownerId: $UID, status: 'draft' } },
                            relations: { owner: { connect: { conditions: { id: $UID } } } },
                        },
                    },
                },
                ownerNoWrite,
            );
            expect(issues).toEqual([]);
        });

        test('ERROR: `set` foreign key on create with no connect rule', () => {
            const issues = validatePermissionsConfig(
                { Project: { USER: { create: { set: { ownerId: $UID } } } } },
                ownerNoWrite,
            );
            expect(codes(issues)).toEqual(['missing-connect-required']);
            expect(issues[0].message).toMatch(/server-set via 'set'/);
        });

        test('ERROR: `set` foreign key on update with no connect rule', () => {
            const issues = validatePermissionsConfig(
                { Project: { USER: { updateMany: { conditions: {}, set: { ownerId: $UID } } } } },
                ownerNoWrite,
            );
            expect(codes(issues)).toEqual(['missing-connect']);
            expect(issues[0].message).toMatch(/update/);
        });

        test('ERROR: `set` naming a relation instead of its foreign key column', () => {
            const issues = validatePermissionsConfig(
                {
                    Project: {
                        USER: {
                            create: { set: { owner: $UID } },
                            relations: { owner: { connect: 'ALL' } },
                        },
                    },
                },
                ownerNoWrite,
            );
            expect(codes(issues)).toEqual(['connect-on-unwritable', 'relation-in-set']);
        });

        test('ERROR: a leftover `setUserIdField` is rejected with its replacement', () => {
            const issues = validatePermissionsConfig(
                {
                    Project: {
                        USER: {
                            create: { conditions: {}, setUserIdField: 'ownerId' },
                            relations: { owner: { connect: { conditions: { id: $UID } } } },
                        },
                    },
                } as any,
                ownerNoWrite,
            );
            expect(codes(issues)).toContain('removed-set-user-id-field');
            expect(issues.find((i) => i.code === 'removed-set-user-id-field')!.message).toMatch(/set: \{ ownerId: '\$USER_ID' \}/);
        });

        test('a @NoWrite FK not named by `set` stays unsettable (no requirement)', () => {
            const issues = validatePermissionsConfig({ Project: { USER: { create: 'ALL' } } }, ownerNoWrite);
            expect(issues).toEqual([]);
        });
    });

    test('ERROR: an update-only model with a settable FK and no connect rule', () => {
        const issues = validatePermissionsConfig(
            { Task: { USER: { updateMany: 'ALL' } }, Project: { USER: { connect: 'ALL' } } },
            relations,
        );
        // project satisfied; assignee (settable on update) is not → error.
        expect(codes(issues)).toEqual(['missing-connect']);
        expect(issues[0].message).toMatch(/update/);
    });

    test('ERROR: a create condition that references a relation', () => {
        const issues = validatePermissionsConfig(
            {
                // owner is a relation nav field → not allowed in a create condition
                Project: { USER: { create: { conditions: { owner: { id: $UID } } } } },
                User: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(codes(issues)).toEqual(['relation-in-create-condition']);
        expect(issues[0].message).toMatch(/references relation 'owner'/);
    });

    test('a create condition on the own scalar FK is fine (not a relation clause)', () => {
        const issues = validatePermissionsConfig(
            {
                Project: { USER: { create: { conditions: { ownerId: $UID } } } },
                User: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(issues).toEqual([]);
    });

    test('relation clause is detected inside AND/OR/NOT', () => {
        const issues = validatePermissionsConfig(
            {
                Project: {
                    USER: { create: { conditions: { OR: [{ ownerId: $UID }, { owner: { id: $UID } }] } } },
                },
                User: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(codes(issues)).toEqual(['relation-in-create-condition']);
    });

    test('createMany triggers the same FK requirement as create', () => {
        const issues = validatePermissionsConfig(
            { Project: { USER: { createMany: 'ALL' } } },
            relations,
        );
        expect(codes(issues)).toEqual(['missing-connect-required']);
    });

    test('per-role: only the role that can create without connect is flagged', () => {
        const issues = validatePermissionsConfig(
            {
                Project: { ADMIN: { create: 'ALL' }, USER: { create: 'ALL' } },
                User: { ADMIN: { connect: 'ALL' } }, // USER has no connect
            },
            relations,
        );
        expect(issues).toHaveLength(1);
        expect(issues[0]).toMatchObject({ level: 'error', role: 'USER' });
    });

    test('a relation-scoped connect on the source satisfies a required FK (no destination rule needed)', () => {
        const issues = validatePermissionsConfig(
            {
                // Task.project is required; authorize it on the relation instead of Project.connect.
                // (User.connect covers the optional assignee, isolating the project check.)
                Task: { USER: { create: 'ALL', relations: { project: { connect: 'ALL' } } } },
                User: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(issues).toEqual([]);
    });

    test('WARNING: a relations key that is not a real relation of the model', () => {
        const issues = validatePermissionsConfig(
            {
                Project: {
                    USER: { create: 'ALL', relations: { notARelation: { connect: 'ALL' } } },
                },
                User: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(codes(issues)).toEqual(['unknown-relation']);
        expect(issues[0]).toMatchObject({ level: 'warning', model: 'Project', role: 'USER' });
    });

    test('case-insensitive model matching for the connect lookup', () => {
        const issues = validatePermissionsConfig(
            {
                project: { USER: { create: 'ALL' } }, // lower-case model key
                user: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(issues).toEqual([]);
    });

    describe('fields (row-conditional visibility)', () => {
        // Scalar columns per model → their @Role list (null when unannotated).
        const columns: SchemaColumns = {
            user: { id: null, email: null, role: null, password: ['none'] },
            project: { id: null, name: null, ownerId: null, secretApiKey: ['ADMIN'] },
        };
        const check = (config: any) => validatePermissionsConfig(config, relations, columns);

        test('own-scalar condition on a readable column → valid', () => {
            expect(check({
                User: { USER: { findMany: 'ALL', fields: { email: { visibleOnlyWhen: { id: $UID } } } } },
                Project: { USER: { fields: { name: { visibleOnlyWhen: { OR: [{ ownerId: $UID }, { id: { in: [1, 2] } }] } } } } },
            })).toEqual([]);
        });

        test('ERROR: a fields key that is not a column of the model', () => {
            const issues = check({ User: { USER: { fields: { emial: { visibleOnlyWhen: { id: $UID } } } } } });
            expect(codes(issues)).toEqual(['unknown-field']);
            expect(issues[0]).toMatchObject({ level: 'error', model: 'User', role: 'USER' });
        });

        test('ERROR: a fields key that names a relation', () => {
            const issues = check({ Project: { USER: { fields: { owner: { visibleOnlyWhen: { id: $UID } } } } } });
            expect(codes(issues)).toEqual(['unknown-field']);
        });

        test('ERROR: a field rule without a visibleOnlyWhen condition', () => {
            expect(codes(check({ User: { USER: { fields: { email: {} } } } }))).toEqual(['invalid-field-rule']);
            expect(codes(check({ User: { USER: { fields: { email: 'ALL' } } } }))).toEqual(['invalid-field-rule']);
        });

        test('ERROR: visibleOnlyWhen crosses a relation (also inside AND/OR/NOT)', () => {
            const issues = check({
                Project: { USER: { fields: { name: { visibleOnlyWhen: { AND: [{ ownerId: $UID }, { NOT: { owner: { role: 'ADMIN' } } }] } } } } },
            });
            expect(codes(issues)).toEqual(['field-condition-not-own-column']);
            expect(issues[0].message).toContain("'owner'");
        });

        test('ERROR: visibleOnlyWhen names a column the model does not have', () => {
            const issues = check({ User: { USER: { fields: { email: { visibleOnlyWhen: { userId: $UID } } } } } });
            expect(codes(issues)).toEqual(['field-condition-not-own-column']);
        });

        test('WARNING: the column\'s @Role list excludes the role, so the rule never shows it', () => {
            const issues = check({
                Project: { USER: { fields: { secretApiKey: { visibleOnlyWhen: { ownerId: $UID } } } }, ADMIN: { fields: { secretApiKey: { visibleOnlyWhen: { ownerId: $UID } } } } },
                User: { USER: { fields: { password: { visibleOnlyWhen: { id: $UID } } } } },
            });
            expect(codes(issues)).toEqual(['field-never-visible', 'field-never-visible']);
            expect(issues.every((i) => i.level === 'warning' && i.role === 'USER')).toBe(true);
        });

        test('fields checks run for roles that cannot create or update', () => {
            const issues = check({ User: { GUEST: { findMany: 'ALL', fields: { nope: { visibleOnlyWhen: { id: $UID } } } } } });
            expect(codes(issues)).toEqual(['unknown-field']);
        });
    });
});
