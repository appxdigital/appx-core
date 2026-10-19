/**
 * Static validation of a `PermissionsConfig` against the Prisma schema.
 *
 * Runs at boot (in the PrismaService constructor). It encodes the Option A
 * authorization model: a create condition judges a model's own scalar fields
 * only, and every foreign-key reference a create establishes is authorized by
 * the target model's `connect` rule. Misconfigurations that would break at
 * runtime are surfaced here — errors reject boot, warnings are advisory.
 *
 * Pure and schema-only (no database), so it is independently unit-testable.
 */
import type { PermissionsConfigType } from '../common/config/permissionsConfigTypes';

export type RelationKind = 'belongsTo' | 'hasMany';

export interface RelationMeta {
    /** The relation navigation field name on the owning model. */
    field: string;
    /** The target model name (original casing, as in the schema). */
    model: string;
    /** The owning model's scalar FK column (belongsTo only). */
    referencingColumn?: string;
    isRequired: boolean;
    kind: RelationKind;
    /** False when the scalar FK is @NoWrite / @Role(none) (never client-writable). Defaults to writable. */
    fkWritable?: boolean;
}

/** Relations per model, keyed by the lower-cased model name. */
export type SchemaRelations = Record<string, RelationMeta[]>;

/** Scalar columns per model (lower-cased model name) → the column's `@Role` list, or null when unannotated. */
export type SchemaColumns = Record<string, Record<string, string[] | null>>;

export type IssueLevel = 'error' | 'warning';

export type IssueCode =
    | 'relation-in-create-condition'
    | 'missing-connect-required'
    | 'missing-connect'
    | 'connect-on-unwritable'
    | 'relation-in-set'
    | 'removed-set-user-id-field'
    | 'unknown-relation'
    | 'unknown-field'
    | 'invalid-field-rule'
    | 'field-condition-not-own-column'
    | 'unsupported-field-operator'
    | 'field-never-visible';

export interface ValidationIssue {
    level: IssueLevel;
    code: IssueCode;
    model: string;
    role: string;
    message: string;
}

/** Collects the condition keys `relationFields` has (skips AND/OR/NOT, which recurse). */
function findRelationKeys(cond: any, relationFields: Pick<Set<string>, 'has'>, found = new Set<string>()): Set<string> {
    if (!cond || typeof cond !== 'object') return found;
    const objs = Array.isArray(cond) ? cond : [cond];
    for (const obj of objs) {
        if (!obj || typeof obj !== 'object') continue;
        for (const key of Object.keys(obj)) {
            if (key === 'AND' || key === 'OR' || key === 'NOT') {
                findRelationKeys(obj[key], relationFields, found);
                continue;
            }
            if (relationFields.has(key)) found.add(key);
        }
    }
    return found;
}

/** Operators a `fields` condition can use (judged per row, in memory). */
const FIELD_OPERATORS = new Set(['equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte']);

/** Collects the operators on `columns` clauses outside {@link FIELD_OPERATORS} (recurses AND/OR/NOT). */
function findUnsupportedOperators(cond: any, columns: Record<string, unknown>, found = new Set<string>()): Set<string> {
    for (const obj of [cond].flat()) {
        for (const key of Object.keys(obj)) {
            const value = obj[key];
            if (key === 'AND' || key === 'OR' || key === 'NOT') findUnsupportedOperators(value, columns, found);
            else if (key in columns && value && typeof value === 'object' && !(value instanceof Date)) {
                for (const op of Object.keys(value)) if (!FIELD_OPERATORS.has(op)) found.add(op);
            }
        }
    }
    return found;
}

/**
 * Validates the permissions config against the schema relations.
 *
 * Checks, per model + role that can create the model:
 *  - **error** `relation-in-create-condition` — a create condition references a
 *    relation. Create conditions are own-scalar-only; relationship checks belong
 *    on the target's `connect` rule.
 *  - **error** `missing-connect-required` — a *required* belongsTo FK's target
 *    has no `connect` rule for the role. Every create sets it, so it will always
 *    be denied at runtime.
 *  - **warning** `missing-connect-optional` — an *optional* belongsTo FK's target
 *    has no `connect` rule for the role. Only denied when the payload sets it.
 *
 * And, per model + role with a `fields` map:
 *  - **error** `unknown-field` / `invalid-field-rule` — the key is not a column
 *    of the model, or the rule has no `visibleOnlyWhen` condition.
 *  - **error** `field-condition-not-own-column` — `visibleOnlyWhen` names a
 *    relation or a column the model doesn't have (it is evaluated per row,
 *    against the model's own columns).
 *  - **error** `unsupported-field-operator` — an operator other than
 *    equals/not/in/notIn/lt/lte/gt/gte.
 *  - **warning** `field-never-visible` — the column's `@Role` list excludes the
 *    role, so the rule can never show it.
 */
export function validatePermissionsConfig(
    config: PermissionsConfigType,
    relations: SchemaRelations,
    columns: SchemaColumns = {},
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Iterate the typed config structurally — model/role keys are dynamic, and
    // condition/rule shapes are inspected at runtime.
    const cfg = (config || {}) as Record<string, Record<string, any>>;
    const byModel: Record<string, Record<string, any>> = {};
    for (const m of Object.keys(cfg)) byModel[m.toLowerCase()] = cfg[m];

    const hasConnectRule = (targetModel: string, role: string): boolean => {
        const rules = byModel[targetModel.toLowerCase()]?.[role];
        return !!rules && rules.connect !== undefined && rules.connect !== null;
    };
    // A relation-scoped connect on the source (creating) model authorizes that
    // relation on its own — the target model then needs no connect rule.
    const hasRelationConnect = (sourceRules: any, field: string): boolean =>
        !!sourceRules?.relations?.[field]?.connect;
    const canCreate = (rules: any): boolean =>
        !!rules && (rules.create !== undefined || rules.createMany !== undefined);
    const canUpdate = (rules: any): boolean =>
        !!rules && (rules.update !== undefined || rules.updateMany !== undefined);
    // Columns a rule's `set` writes server-side.
    const setColumns = (...actionRules: any[]): Set<string> =>
        new Set(actionRules.flatMap((rule) => (rule && typeof rule === 'object' && rule.set ? Object.keys(rule.set) : [])));

    for (const modelKey of Object.keys(cfg)) {
        const roles = cfg[modelKey] || {};
        const rels = relations[modelKey.toLowerCase()] || [];
        const belongsTo = rels.filter((r) => r.kind === 'belongsTo' && r.referencingColumn);
        const relationFieldNames = new Set(rels.map((r) => r.field));
        const modelColumns = columns[modelKey.toLowerCase()] || {};
        const notOwnColumn = { has: (key: string) => !(key in modelColumns) };

        for (const role of Object.keys(roles)) {
            const rules = roles[role];
            const fieldsMap = rules?.fields;
            if (fieldsMap && typeof fieldsMap === 'object') {
                for (const column of Object.keys(fieldsMap)) {
                    const issue = (level: IssueLevel, code: IssueCode, message: string) =>
                        issues.push({ level, code, model: modelKey, role, message });
                    const condition = fieldsMap[column]?.visibleOnlyWhen;
                    if (!(column in modelColumns)) {
                        issue('error', 'unknown-field', `${modelKey}.${role}.fields.${column} does not name a column of ${modelKey}. Check the field name.`);
                    } else if (!condition || typeof condition !== 'object') {
                        issue('error', 'invalid-field-rule', `${modelKey}.${role}.fields.${column} needs a condition: '{ visibleOnlyWhen: { ... } }'.`);
                    } else {
                        for (const key of findRelationKeys(condition, notOwnColumn)) {
                            issue('error', 'field-condition-not-own-column', `${modelKey}.${role}.fields.${column}.visibleOnlyWhen references '${key}', which is not a column of ${modelKey}. The condition can use the model's own columns only.`);
                        }
                        for (const op of findUnsupportedOperators(condition, modelColumns)) {
                            issue('error', 'unsupported-field-operator', `${modelKey}.${role}.fields.${column}.visibleOnlyWhen uses '${op}', which a per-row check does not support. Use equals, not, in, notIn, lt, lte, gt or gte.`);
                        }
                        const readers = modelColumns[column];
                        if (readers && !readers.includes(role)) {
                            issue('warning', 'field-never-visible', `${modelKey}.${role}.fields.${column} has no effect: the column's @Role list excludes ${role}, so it is never returned to that role.`);
                        }
                    }
                }
            }
            // `setUserIdField` was removed; left in a config it would silently stop
            // forcing the column, so it is rejected with its replacement.
            for (const action of Object.keys(rules || {})) {
                const field = rules[action]?.setUserIdField;
                if (field !== undefined) {
                    issues.push({
                        level: 'error',
                        code: 'removed-set-user-id-field',
                        model: modelKey,
                        role,
                        message: `${modelKey}.${role}.${action}.setUserIdField was removed. Replace it with '${action}: { set: { ${field}: '$USER_ID' } }' (applied on every write path; its foreign key needs a 'connect' rule).`,
                    });
                }
            }
            const creatable = canCreate(rules);
            const updatable = canUpdate(rules);
            if (!creatable && !updatable) continue;

            const createRule = rules.create ?? rules.createMany;
            const conditions =
                createRule && typeof createRule === 'object' ? createRule.conditions : undefined;
            if (conditions) {
                for (const relField of findRelationKeys(conditions, relationFieldNames)) {
                    issues.push({
                        level: 'error',
                        code: 'relation-in-create-condition',
                        model: modelKey,
                        role,
                        message: `create condition on ${modelKey}.${role} references relation '${relField}'. Create conditions judge own scalar fields only — authorize relationships with the target model's 'connect' rule.`,
                    });
                }
            }

            // Every foreign key a write can SET must have a connect rule (target
            // or relation-scoped) — otherwise setting it is denied at runtime.
            // A @NoWrite / @Role(none) column is never client-settable, but a
            // column in the rule's `set` is written server-side.
            const createSet = setColumns(rules.create, rules.createMany);
            const updateSet = setColumns(rules.update, rules.updateMany);
            for (const column of new Set([...createSet, ...updateSet])) {
                if (relationFieldNames.has(column)) {
                    issues.push({
                        level: 'error',
                        code: 'relation-in-set',
                        model: modelKey,
                        role,
                        message: `'set' on ${modelKey}.${role} names relation '${column}'. Set its foreign key column instead.`,
                    });
                }
            }
            for (const r of belongsTo) {
                const col = r.referencingColumn as string;
                const writable = r.fkWritable !== false; // not @NoWrite / @Role(none)
                const settableOnCreate = (writable || createSet.has(col)) && creatable;
                const settableOnUpdate = (writable || updateSet.has(col)) && updatable;
                const relRule = hasRelationConnect(rules, r.field);

                if (!settableOnCreate && !settableOnUpdate) {
                    // A relation-scoped connect rule for a field that can't be
                    // written is contradictory — flag it rather than silently ignore.
                    if (relRule) {
                        issues.push({
                            level: 'error',
                            code: 'connect-on-unwritable',
                            model: modelKey,
                            role,
                            message: `${modelKey}.${role}.relations.${r.field}.connect is set, but its foreign key '${col}' is not writable (@NoWrite / @Role(none)). Make the field writable or remove the relation rule.`,
                        });
                    }
                    continue;
                }
                if (relRule || hasConnectRule(r.model, role)) continue;

                // A server-set owner FK (`set`) still needs a connect
                // rule — the server chose the value, but the framework authorizes every
                // relationship a write establishes, uniformly. Point at the
                // relation-scoped self-connect rather than a blanket rule on the
                // target: `connect: 'ALL'` on User would let this role attach ANY
                // user, which is far wider than what a self-owned create needs.
                const fix = createSet.has(col) || updateSet.has(col)
                    ? `'${col}' is server-set via 'set', but the relationship it creates still needs a connect rule. Scope it to the caller with '${modelKey}.${role}.relations.${r.field}.connect: {conditions: {id: "$USER_ID"}}' — prefer that over a blanket '${r.model}.${role}.connect', which would allow connecting to any ${r.model}.`
                    : `Declare '${r.model}.${role}.connect' (or 'ALL'), or scope it to this relation with '${modelKey}.${role}.relations.${r.field}.connect'.`;
                if (settableOnCreate && r.isRequired) {
                    issues.push({
                        level: 'error',
                        code: 'missing-connect-required',
                        model: modelKey,
                        role,
                        message: `${modelKey}.${role} can create, but its required foreign key '${col}' → ${r.model} has no 'connect' rule for ${role}. Every create sets it, so the create is always denied. ${fix}`,
                    });
                } else {
                    issues.push({
                        level: 'error',
                        code: 'missing-connect',
                        model: modelKey,
                        role,
                        message: `${modelKey}.${role} can set foreign key '${col}' → ${r.model} (on ${settableOnCreate ? 'create' : ''}${settableOnCreate && settableOnUpdate ? '/' : ''}${settableOnUpdate ? 'update' : ''}), but ${r.model} has no 'connect' rule for ${role}, so any write that sets it is denied. ${fix}`,
                    });
                }
            }

            // A `relations` key that doesn't name a real relation of this model is
            // almost certainly a typo — it silently does nothing.
            const relationsMap = rules.relations;
            if (relationsMap && typeof relationsMap === 'object') {
                for (const relField of Object.keys(relationsMap)) {
                    if (!relationFieldNames.has(relField)) {
                        issues.push({
                            level: 'warning',
                            code: 'unknown-relation',
                            model: modelKey,
                            role,
                            message: `${modelKey}.${role}.relations.${relField} does not name a relation of ${modelKey} — it has no effect. Check the field name.`,
                        });
                    }
                }
            }
        }
    }

    return issues;
}
