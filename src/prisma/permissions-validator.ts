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
}

/** Relations per model, keyed by the lower-cased model name. */
export type SchemaRelations = Record<string, RelationMeta[]>;

export type IssueLevel = 'error' | 'warning';

export type IssueCode =
    | 'relation-in-create-condition'
    | 'missing-connect-required'
    | 'missing-connect-optional'
    | 'unknown-relation';

export interface ValidationIssue {
    level: IssueLevel;
    code: IssueCode;
    model: string;
    role: string;
    message: string;
}

/** Collects condition keys that name a relation (skips AND/OR/NOT, which recurse). */
function findRelationKeys(cond: any, relationFields: Set<string>, found = new Set<string>()): Set<string> {
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
 */
export function validatePermissionsConfig(
    config: Record<string, Record<string, any>>,
    relations: SchemaRelations,
): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    const byModel: Record<string, Record<string, any>> = {};
    for (const m of Object.keys(config || {})) byModel[m.toLowerCase()] = config[m];

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

    for (const modelKey of Object.keys(config || {})) {
        const roles = config[modelKey] || {};
        const rels = relations[modelKey.toLowerCase()] || [];
        const belongsTo = rels.filter((r) => r.kind === 'belongsTo' && r.referencingColumn);
        const relationFieldNames = new Set(rels.map((r) => r.field));

        for (const role of Object.keys(roles)) {
            const rules = roles[role];
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

            // A required FK is ALWAYS set by a create → hard error. Everything
            // else (optional on create, or any FK set on an update) is a warning:
            // the write only fails if the payload actually sets it.
            for (const r of belongsTo) {
                if (hasRelationConnect(rules, r.field) || hasConnectRule(r.model, role)) continue;
                if (creatable && r.isRequired) {
                    issues.push({
                        level: 'error',
                        code: 'missing-connect-required',
                        model: modelKey,
                        role,
                        message: `${modelKey}.${role} can create, but its required foreign key '${r.referencingColumn}' → ${r.model} has no 'connect' rule for ${role}. Every create sets it, so the create is always denied. Declare '${r.model}.${role}.connect' (or 'ALL'), or scope it to this relation with '${modelKey}.${role}.relations.${r.field}.connect'.`,
                    });
                } else {
                    issues.push({
                        level: 'warning',
                        code: 'missing-connect-optional',
                        model: modelKey,
                        role,
                        message: `${modelKey}.${role} can write ${modelKey} and its foreign key '${r.referencingColumn}' → ${r.model} has no 'connect' rule for ${role}. A create or update that sets it is denied. Declare '${r.model}.${role}.connect' or '${modelKey}.${role}.relations.${r.field}.connect' if that association is expected.`,
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
