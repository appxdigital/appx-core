/**
 * Static permissions-config validator (Option A). Pure function — no database.
 * Covers each error/warning combination the boot gate relies on.
 */
import { validatePermissionsConfig, SchemaRelations } from '../../src/prisma/permissions-validator';

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

    test('WARNING: optional FK target has no connect rule', () => {
        // Task requires project (grant Project.connect) but assignee (User) is optional.
        const issues = validatePermissionsConfig(
            {
                Task: { USER: { create: 'ALL' } },
                Project: { USER: { connect: 'ALL' } },
            },
            relations,
        );
        expect(codes(issues)).toEqual(['missing-connect-optional']);
        expect(issues[0]).toMatchObject({ level: 'warning', role: 'USER' });
        expect(issues[0].message).toMatch(/assigneeId.*User/);
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
                Task: { USER: { create: 'ALL', relations: { project: { connect: 'ALL' } } } },
            },
            relations,
        );
        // assignee (optional User) still warns; project (required) is satisfied → no error.
        expect(issues.filter((i) => i.level === 'error')).toEqual([]);
        expect(codes(issues)).toEqual(['missing-connect-optional']);
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
});
