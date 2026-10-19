import {ForbiddenException, HttpException, HttpStatus, Inject, Injectable} from '@nestjs/common';
import {Prisma, PrismaClient} from '@prisma/client';
import {PermissionsConfigType, SINGULAR_ACTION} from '../common/config/permissionsConfigTypes';
import {validatePermissionsConfig, SchemaRelations, SchemaColumns} from './permissions-validator';
import {RequestContext} from "nestjs-request-context";
import type {PrismaClient as RuntimeClient} from '.prisma/client';
// @ts-ignore
import {RuntimeDataModel} from "@prisma/client/runtime/edge";
import {AsyncLocalStorage} from 'node:async_hooks';
import {annotationText} from '../common/utils/schema-annotations.util';

export const CorePrismaContext = new AsyncLocalStorage<{
    exposedModels: string[]
}>();

type ModelKey = keyof RuntimeClient;

/** Extra options available on every model method */
export type CorePrismaOptions = {
    BYPASS_OMISSION?: boolean;
    BYPASS_FILTERING?: boolean;
};

/**
 * Per query node: the `fields` rules to check on each returned row, the
 * columns selected only to check them, and the same for nested relations.
 */
type FieldVisibilityPlan = {
    model: string;
    conditions: Record<string, any>;
    injected: string[];
    relations: Record<string, FieldVisibilityPlan>;
};

/** Methods whose returned rows are masked by `fields` rules. */
const ROW_METHODS = ['findFirst', 'findFirstOrThrow', 'findMany', 'create', 'upsert', 'createManyAndReturn', 'updateManyAndReturn'];

/** Look up a delegate method type without constraining the delegate `D`. */
type MethodOf<D, K extends string> = K extends keyof D ? D[K] : never;

/**
 * Re-aligns a Prisma model delegate `D` to the proxy's real contract. Single-
 * record methods that require a unique `where` can't carry the injected ABAC
 * conditions, so each is re-aliased to its filter-compatible equivalent and the
 * proxy transparently redirects the call at runtime:
 *   - `findUnique` takes `findFirst`'s params/return; `findUniqueOrThrow` takes
 *     `findFirstOrThrow`'s.
 *   - `update` takes `updateMany`'s params and returns its result
 *     (`BatchPayload`); `delete` takes `deleteMany`'s.
 */
export type ProxiedDelegate<D> = Omit<D, 'findUnique' | 'findUniqueOrThrow' | 'update' | 'delete'> & {
    findUnique: MethodOf<D, 'findFirst'>;
    findUniqueOrThrow: MethodOf<D, 'findFirstOrThrow'>;
    update: MethodOf<D, 'updateMany'>;
    delete: MethodOf<D, 'deleteMany'>;
};

// The proxied delegate for a model key `M` (kept key-based for existing callers).
export type CorePrismaModel<M extends ModelKey> = ProxiedDelegate<RuntimeClient[M]>;

/**
 * Applies {@link ProxiedDelegate} across every model delegate on a Prisma
 * client, leaving non-delegate members (`$transaction`, `$connect`, …) intact.
 */
export type CorePrismaClient<C> = {
    [K in keyof C]: C[K] extends { findMany: (...args: any[]) => any } ? ProxiedDelegate<C[K]> : C[K];
};

@Injectable()
export class PrismaService {
    private fieldConfigs: Record<string, any> = {};
    prismaClient: PrismaClient;
    /**
     * The un-proxied Prisma client. Used internally (e.g. create-condition
     * checks) to look up an already-existing parent row without re-applying
     * that model's access filtering — matching "would a findFirst with these
     * conditions match".
     */
    private rawClient!: PrismaClient;

    constructor(
        prismaClient: PrismaClient,
        @Inject('PERMISSIONS_CONFIG') private readonly permissionsConfig: PermissionsConfigType,
    ) {
        this.prismaClient = prismaClient;
        this.parseSchema();
        this.validatePermissions();
        this.proxyModels();
    }

    /**
     * Validates the permissions config against the schema at boot. Warnings are
     * logged; errors (a create condition that crosses a relation, or a required
     * FK whose target has no `connect` rule) reject boot — the misconfiguration
     * would otherwise surface as a runtime 403.
     */
    private validatePermissions(): void {
        const relations: SchemaRelations = {};
        const columns: SchemaColumns = {};
        for (const model of Object.keys(this.fieldConfigs)) {
            const relationFields = this.fieldConfigs[model].relationFields || {};
            const noWrite: string[] = this.fieldConfigs[model].noWriteFields || [];
            const scalarFields: string[] = this.fieldConfigs[model].scalarFields || [];
            const fieldConfig = this.fieldConfigs[model].fieldConfig || {};
            // Each scalar column with its @Role list (null when unannotated), for `fields` rules.
            columns[model] = Object.fromEntries(scalarFields.map((field) => [field, fieldConfig[field] ?? null]));
            relations[model] = Object.keys(relationFields).map((field) => ({
                field,
                model: relationFields[field].model,
                referencingColumn: relationFields[field].referencingColumn,
                isRequired: relationFields[field].isRequired,
                kind: relationFields[field].relation,
                // The scalar FK is client-writable unless the column is @NoWrite / @Role(none).
                fkWritable: !noWrite.includes(relationFields[field].referencingColumn),
            }));
        }

        const issues = validatePermissionsConfig(this.permissionsConfig, relations, columns);
        for (const issue of issues.filter((i) => i.level === 'warning')) {
            console.warn('\x1b[33m', `[APPX-CORE PERMISSIONS] ${issue.message}`, '\x1b[0m');
        }
        const errors = issues.filter((i) => i.level === 'error');
        if (errors.length) {
            throw new Error(
                `[APPX-CORE PERMISSIONS] Invalid permissions configuration — ${errors.length} error(s):\n` +
                    errors.map((e) => `  • ${e.message}`).join('\n'),
            );
        }
    }

    debugQueries(enable: boolean) {
        RequestContext.currentContext.req.corePrismaDebug = enable;
    }

    /*
    * Exposes the specified models for the duration of the callback execution.
    */
    withExposedModels(models: string[], callback: () => Promise<void>) {
        const previous = CorePrismaContext.getStore()?.exposedModels || [];
        return new Promise<void>(async (resolve, reject) => {
            CorePrismaContext.run({
                exposedModels: [...new Set([...previous, ...models.map(m => m.toLowerCase())])],
            }, () => {
                callback().then(resolve).catch(reject);
            })
        });
    }

    private debug(msg: string, type: 'log' | 'warn' | 'error' | 'info' = 'log') {
        if (RequestContext.currentContext?.req.corePrismaDebug) {
            // Default for log, yellow for warn, red for error, blue for info
            const color = type === 'log' ? '' : type === 'warn' ? '\x1b[33m' : type === 'error' ? '\x1b[31m' : '\x1b[34m';
            console.debug(color, `[APPX-CORE PRISMA] ${msg}`, '\x1b[0m');
        }
    }

    $transaction<T>(fn: (prisma: Prisma.TransactionClient) => Promise<T>) {
        return this.prismaClient.$transaction(fn);
    }

    proxyModels() {
        // Capture the un-proxied client before wrapping it (used by internal
        // lookups that must bypass this proxy's access filtering — see
        // enforceCreateConditions).
        this.rawClient = this.prismaClient;
        // Proxy client to intercept model calls
        this.prismaClient = new Proxy(this.prismaClient, {
            get: (target, propKey) => {
                const modelDelegate = target[propKey];
                if (typeof modelDelegate === 'object' && modelDelegate !== null && !['$connect', '$disconnect', '$use', '$on'].includes(propKey.toString()) && !propKey.toString().startsWith?.('_') && !propKey.toString().startsWith?.('$')) {
                    // Proxy model methods to apply field omission and where conditions
                    return new Proxy(modelDelegate, {
                        get: (model, methodKey) => {
                            const user = RequestContext.currentContext?.req.user || {};
                            const userRole = user?.role || 'GUEST';
                            if (typeof model[methodKey] === 'function' && !methodKey.toString().startsWith('_') && !methodKey.toString().startsWith('$')) {
                                this.debug(`Proxying ${String(propKey)}.${String(methodKey)}() for role ${userRole}`);
                                const contextModel = RequestContext.currentContext?.req.prisma?.[propKey] || model;
                                return async (params: any = {}, options?: CorePrismaOptions) => {

                                    // Single-record methods can't carry the injected ABAC where-
                                    // conditions, so redirect them to their filter-compatible
                                    // equivalents. The proxied types remove/re-alias these, so this
                                    // matches what a typed caller can express: update() runs
                                    // updateMany, delete() runs deleteMany, and a findUnique lookup
                                    // becomes a findFirst with conditions applied.
                                    const redirect: {[key: string]: string} = {
                                        findUnique: 'findFirst',
                                        findUniqueOrThrow: 'findFirstOrThrow',
                                        delete: 'deleteMany',
                                        update: 'updateMany',
                                    };
                                    methodKey = redirect[methodKey.toString()] ?? methodKey;

                                    // delete, deleteMany, update, updateMany and createMany return no rows, so there is nothing to omit
                                    if (!options?.BYPASS_OMISSION && !['delete', 'deleteMany', 'update', 'updateMany', 'createMany'].includes(methodKey.toString())) {
                                        params = this.applyFieldOmission(String(propKey), userRole, params);
                                    } else {
                                        this.debug(`Skipping field omission for ${String(propKey)}.${String(methodKey)}()`);
                                    }
                                    if (!options?.BYPASS_FILTERING) {
                                        if (['create', 'createMany'].includes(methodKey.toString())) {
                                            this.applySetValues(String(propKey), userRole, params.data, user, methodKey.toString());
                                            // Conditions can't be pushed into a WHERE on insert, so
                                            // validate the incoming data satisfies them before insert.
                                            await this.enforceCreateConditions(String(propKey), userRole, params, user, methodKey.toString());
                                            // Authorize any relation the write establishes (nested
                                            // create/connect, or a raw foreign key).
                                            await this.enforceNestedWrites(String(propKey), params.data, user, userRole);
                                        } else {
                                            // Reject a client where/orderBy/distinct/cursor that references a
                                            // field this role can't read (input counterpart to output
                                            // field omission). Runs on the client input, BEFORE the
                                            // trusted ABAC conditions are injected below.
                                            this.assertFilterFieldsReadable(String(propKey), userRole, params);
                                            // Scope the client's relation filters to related rows this
                                            // role can read — also on the client input, before injection.
                                            params = this.scopeClientFilters(String(propKey), userRole, params, user);
                                            params = this.applyWhereConditions(String(propKey), userRole, params, user, methodKey);
                                            // An update can re-point a foreign key (scalar column);
                                            // authorize those changes with the same connect rules as create.
                                            if (['update', 'updateMany'].includes(methodKey.toString())) {
                                                this.applySetValues(String(propKey), userRole, params.data, user, methodKey.toString());
                                                await this.enforceNestedWrites(String(propKey), params.data, user, userRole);
                                            }
                                        }
                                    } else {
                                        this.debug(`Skipping permission filtering for ${String(propKey)}.${String(methodKey)}()`);
                                    }
                                    if (methodKey === 'count' && !!params.select) {
                                        delete params.select;
                                    }
                                    // Row-conditional field visibility: select what each `fields`
                                    // rule reads, then remove the column from rows that don't match.
                                    const visibility = !options?.BYPASS_OMISSION && ROW_METHODS.includes(methodKey.toString())
                                        ? this.prepareFieldVisibility(String(propKey), userRole, params.select, user)
                                        : undefined;
                                    this.debug(`Executing ${String(propKey)}.${String(methodKey)}() with params: ${JSON.stringify(params)}`);
                                    const result = await contextModel[methodKey](params);
                                    if (visibility) {
                                        await this.maskFieldVisibility(result, visibility);
                                    }
                                    // Dev-only: warn if a just-created row wouldn't be readable by its
                                    // creator (create conditions broader than find conditions). Skipped
                                    // outside development so no extra query runs on the hot path.
                                    if (methodKey === 'create' && !options?.BYPASS_FILTERING && this.isDevMode()) {
                                        await this.warnIfCreatedRowNotFindable(String(propKey), userRole, result);
                                    }
                                    return result;
                                };
                            }
                            return model[methodKey];
                        },
                    });
                }
                return modelDelegate;
            },
        });
    }

    /**
     * Retrieves the model delegate from the Prisma client.
     * Used in the graphql generic resolver
     * @param model
     */
    getModelDelegate<M extends ModelKey>(model: M): CorePrismaModel<M> {
        // Prisma exposes delegates in camelCase (`client.albumMember`), lowercasing
        // only the FIRST character of the model name. Callers pass the PascalCase
        // class name (`model.name`), so lowercase just the first char — NOT the
        // whole string, which would flatten any internal capital (`AlbumMember` →
        // `albummember`) and miss the delegate. (The framework's own model-name
        // namespace is deliberately whole-lowercase for case-insensitivity, but
        // that is a separate lookup; this one indexes the real Prisma client.)
        const name = model as string;
        const modelName = name.charAt(0).toLowerCase() + name.slice(1);

        const client = this.prismaClient;

        if (modelName in client) {
            return client[modelName];
        }

        throw new Error(`Model ${model.toString()} not found in PrismaClient.`);
    }

    get model(): CorePrismaClient<RuntimeClient> {
        return new Proxy(this.prismaClient, {
            get: (target: RuntimeClient, prop: ModelKey) => {
                if (prop in target) {
                    return target[prop];
                } else {
                    throw new Error(`Model ${String(prop)} does not exist on PrismaClient`);
                }
            },
        }) as unknown as CorePrismaClient<RuntimeClient>;
    }

    get user(): CorePrismaModel<'user'> {
        return this.prismaClient.user;
    }

    get session(): CorePrismaModel<'session'> {
        return this.prismaClient.session;
    }

    get userRefreshToken() {
        return this.prismaClient.userRefreshToken;
    }

    /**
     * Parses the Prisma schema to extract model information and field configurations
     * including custom annotations (e.g., @Role(CLIENT)) and enums.
     */
    parseSchema() {
        let data_model = this.prismaClient._runtimeDataModel as RuntimeDataModel;

        for (const model_name in data_model.models) {
            let fields = data_model.models[model_name].fields;

            const allFields: string[] = [];
            const fieldConfig: Record<string, string[]> = {};
            const fieldTypes: Record<string, string> = {};
            const scalarFields: string[] = [];
            const relationFields: Record<string, any> = {};
            const noWriteFields: string[] = [];
            const nullableFields: string[] = [];

            for (const field of fields) {
                let field_name = field.name;

                const fieldType = field.type;
                const commentPart = annotationText(field.documentation);

                if (commentPart) {
                    const roleMatch = commentPart.match(/@Role\((.*?)\)/);
                    if (roleMatch) {
                        fieldConfig[field_name] = roleMatch[1].split(',').map((role: string) => role.trim());
                    }
                    // Fields excluded from write DTOs — never client-writable.
                    if (/@NoWrite\b/.test(commentPart) || /@Role\(\s*none\s*\)/i.test(commentPart)) {
                        noWriteFields.push(field_name);
                    }
                }

                allFields.push(field_name);
                fieldTypes[field_name] = fieldType;

                if (field.kind === 'scalar' || field.kind === 'enum') {
                    scalarFields.push(field_name);
                    if (!field.isRequired && !field.isList && fieldType !== 'Json') {
                        nullableFields.push(field_name);
                    }
                } else {
                    relationFields[field_name] = {
                        model: field.type,
                        relation: field.isList ? 'hasMany' : 'belongsTo',
                        isRequired: field.isRequired,
                        // Disambiguates multiple relations between the same two models
                        // (e.g. Task.assignee / Task.reviewer, self-relations) so the
                        // inverse (back-reference) side can be paired reliably.
                        relationName: field.relationName,
                    }
                    if (!field.isList && field.relationToFields && field.relationFromFields) {
                        relationFields[field_name].foreignKey = field.relationToFields[0];
                        relationFields[field_name].referencingColumn = field.relationFromFields[0];
                    }
                }
            }

            this.fieldConfigs[model_name.toLowerCase()] = {
                fieldConfig,
                allFields,
                fieldTypes,
                scalarFields,
                relationFields,
                noWriteFields,
                nullableFields,
            };
        }
    }

    /**
     * Applies field omission logic based on the user's role.
     * Fields that the user does not have permission to access are removed from the query.
     *
     * @param modelName - The name of the Prisma model being queried.
     * @param userRole - The current user's role (e.g., 'ADMIN', 'CLIENT').
     * @param args - The query arguments, including `select` or `include`.
     * @returns The modified query arguments with omitted fields.
     */
    private applyFieldOmission(
        modelName: string,
        userRole: string,
        args: Record<string, any>,
    ): any {
        this.debug(`Applying field omission for model ${modelName} and role ${userRole}`);
        const omitFields = this.getFieldsToOmit(modelName, userRole);
        if (!args) {
            args = {};
        }

        if (args.select) {
            omitFields.forEach((field) => {
                delete args.select[field];
            });
            // Omission must also apply to nested relation selections. Without this,
            // a caller reads an omitted field on a RELATED model by nesting the
            // request (e.g. `select: { rel: { select: { secret: true } } }`) — the
            // top-level delete above only covers this model's own fields.
            for (const key of Object.keys(args.select)) {
                const relation = this.getRelation(modelName, key);
                if (!relation) {
                    continue; // scalar field (`true`) or `_count` — nothing to recurse
                }
                const relatedOmit = this.getFieldsToOmit(relation.model, userRole);
                const value = args.select[key];
                if (value === true) {
                    // `rel: true` returns every scalar of the related model — narrow
                    // it to the readable ones.
                    args.select[key] = {
                        select: this.buildSelectFields(relation.model, relatedOmit, null, null, userRole),
                    };
                } else if (value && typeof value === 'object') {
                    if (value.select || value.include) {
                        // Recurse — strips the related model's omitted fields (and
                        // deeper) while preserving any where/orderBy/take on `value`.
                        args.select[key] = this.applyFieldOmission(relation.model, userRole, value);
                    } else {
                        // Relation args with no explicit projection (e.g. `{ where }`)
                        // — inject a select that excludes omitted fields.
                        value.select = this.buildSelectFields(relation.model, relatedOmit, null, null, userRole);
                    }
                }
            }
        } else if (args.include) {
            this.debug(`Found included model '${modelName}', generating select fields`);
            args.select = this.buildSelectFields(
                modelName,
                omitFields,
                args.include,
                null,
                userRole,
            );
            delete args.include;
        } else {
            args.select = this.buildSelectFields(
                modelName,
                omitFields,
                null,
                null,
                userRole,
            );
        }
        return args;
    }

    /**
     * Plans `fields` (`visibleOnlyWhen`) masking for a select tree: records the
     * resolved condition of each selected conditional column, adds the columns
     * those conditions read to the select (remembering the ones it added), and
     * recurses into selected relations. Exposed models are skipped. Returns
     * undefined when nothing in the tree is conditional.
     */
    private prepareFieldVisibility(modelName: string, userRole: string, select: any, user: any): FieldVisibilityPlan | undefined {
        if (!select) return undefined;
        const rules = this.fieldRules(modelName, userRole);

        const plan: FieldVisibilityPlan = {model: modelName, conditions: {}, injected: [], relations: {}};
        for (const field of Object.keys(rules)) {
            if (select[field] !== true) continue; // not selected, or omitted by @Role
            plan.conditions[field] = PrismaService._buildConditions(rules[field].visibleOnlyWhen, user);
            for (const column of this.conditionColumns(plan.conditions[field])) {
                if (!select[column]) {
                    select[column] = true;
                    plan.injected.push(column);
                }
            }
        }
        for (const key of Object.keys(select)) {
            const relation = this.getRelation(modelName, key);
            const relationPlan = relation && this.prepareFieldVisibility(relation.model, userRole, select[key].select, user);
            if (relationPlan) plan.relations[key] = relationPlan;
        }
        return Object.keys(plan.conditions).length || Object.keys(plan.relations).length ? plan : undefined;
    }

    /** The role's `fields` rules on a model, keyed by column (none on an exposed model). */
    private fieldRules(modelName: string, userRole: string): Record<string, {visibleOnlyWhen: any}> {
        const exposedModels = (CorePrismaContext.getStore()?.exposedModels || []).map((m: string) => m.toLowerCase());
        if (exposedModels.includes(modelName.toLowerCase())) return {};
        return this.normalizedPermissionsConfig[modelName.toLowerCase()]?.[userRole]?.fields || {};
    }

    /** The columns a (own-column) condition reads, through AND / OR / NOT. */
    private conditionColumns(cond: any): string[] {
        return [cond].flat().flatMap((c) =>
            Object.keys(c).flatMap((key) => (['AND', 'OR', 'NOT'].includes(key) ? this.conditionColumns(c[key]) : [key])),
        );
    }

    /**
     * Applies a {@link FieldVisibilityPlan} to a query result: on each row, judges
     * every rule against the row as read, then removes the columns whose rule
     * doesn't match and the columns added only for the check.
     */
    private async maskFieldVisibility(rows: any, plan: FieldVisibilityPlan): Promise<void> {
        for (const row of [rows].flat()) {
            if (!row) continue;
            const hidden: string[] = [];
            for (const field of Object.keys(plan.conditions)) {
                if (!(await this.matchesCreateConditions(plan.conditions[field], row, plan.model))) hidden.push(field);
            }
            for (const field of [...hidden, ...plan.injected]) delete row[field];
            for (const key of Object.keys(plan.relations)) {
                await this.maskFieldVisibility(row[key], plan.relations[key]);
            }
        }
    }

    get normalizedPermissionsConfig() {
        const normalizedConfig: any = {};
        for (const model in this.permissionsConfig) {
            normalizedConfig[model.toLowerCase()] = this.permissionsConfig[model];
        }
        return normalizedConfig;
    }

    /**
     * Applies `where` conditions to the query based on the user's role and the action being performed.
     * The conditions are pulled from the `PermissionsConfig`.
     *
     * @param modelName - The name of the model being queried.
     * @param userRole - The role of the user making the request.
     * @param args - The query arguments (including `where`).
     * @param user - The user object containing information like `id`.
     * @param action - The action being performed (e.g., 'find', 'update').
     * @returns The modified query arguments with the appropriate `where` conditions applied.
     * @throws ForbiddenException if no valid `where` conditions are present after applying permissions.
     */
    /**
     * Reject a client `where` / `orderBy` / `distinct` / `cursor` that references
     * a field this role cannot read (per `@Role` / `getFieldsToOmit`) — the
     * input-side counterpart to `applyFieldOmission` on output, so a field the
     * caller can't read can't be used to filter, sort or page either. Recurses through relations and
     * AND/OR/NOT. Runs on the CLIENT args, before the trusted author-defined
     * conditions are injected, so it never blocks the framework's own conditions.
     */
    private assertFilterFieldsReadable(modelName: string, userRole: string, args: any): void {
        if (!args || typeof args !== 'object') return;
        if (args.where) this.assertClauseFieldsReadable(modelName, userRole, args.where, 'where');
        if (args.orderBy) this.assertClauseFieldsReadable(modelName, userRole, args.orderBy, 'orderBy');
        if (args.cursor) this.assertClauseFieldsReadable(modelName, userRole, args.cursor, 'cursor');
        if (args.distinct) {
            const omit = new Set([...this.getFieldsToOmit(modelName, userRole), ...Object.keys(this.fieldRules(modelName, userRole))]);
            for (const field of ([] as string[]).concat(args.distinct)) {
                if (omit.has(field)) this.throwUnreadableFilterField(modelName, field, userRole, 'distinct');
            }
        }
        for (const [relatedModel, nested] of this.nestedReadArgs(modelName, args)) {
            this.assertFilterFieldsReadable(relatedModel, userRole, nested);
        }
    }

    /**
     * The read args nested in a selection — each selected relation's args and
     * each `_count` entry — paired with the model they read, so client
     * filters are checked/scoped at every level.
     */
    private nestedReadArgs(modelName: string, args: any): [string, any][] {
        const projection = args.select ?? args.include;
        if (!projection || typeof projection !== 'object') return [];
        const nested: [string, any][] = [];
        for (const key of Object.keys(projection)) {
            const isCount = key === '_count';
            const entries = isCount ? projection[key]?.select : {[key]: projection[key]};
            if (!entries || typeof entries !== 'object') continue;
            for (const field of Object.keys(entries)) {
                const relation = this.getRelation(modelName, field);
                if (relation && entries[field] && typeof entries[field] === 'object') nested.push([relation.model, entries[field]]);
            }
        }
        return nested;
    }

    /**
     * Rewrite every relation filter in the CLIENT's `where` (top level and in
     * nested relation selections) so it only takes into account related rows
     * this role can read. Runs on the client input, before the trusted ABAC
     * conditions are injected, so those are never rewritten.
     */
    private scopeClientFilters(modelName: string, userRole: string, args: any, user: any): any {
        if (!args || typeof args !== 'object') return args;
        if (args.where) args.where = this.scopeRelationFilters(modelName, userRole, args.where, user);
        for (const [relatedModel, nested] of this.nestedReadArgs(modelName, args)) {
            this.scopeClientFilters(relatedModel, userRole, nested, user);
        }
        return args;
    }

    /**
     * Rewrite one client `where` clause: each relation filter is narrowed to the
     * related rows the role can read (`some`/`none`/`is`/`isNot` AND the target's
     * read conditions; `every` holds over the readable rows only). A relation
     * into a model with no read rule for the role is rejected.
     */
    private scopeRelationFilters(modelName: string, userRole: string, clause: any, user: any): any {
        if (Array.isArray(clause)) return clause.map((c) => this.scopeRelationFilters(modelName, userRole, c, user));
        if (!clause || typeof clause !== 'object') return clause;

        const rules = this.fieldRules(modelName, userRole);
        const guards: any[] = [];
        const scoped: any = {};
        for (const key of Object.keys(clause)) {
            const value = clause[key];
            if (key === 'AND' || key === 'OR' || key === 'NOT') {
                scoped[key] = this.scopeRelationFilters(modelName, userRole, value, user);
                continue;
            }
            // A predicate on a `fields` column only matches rows where it is
            // visible (presence checks reveal no value and stay as they are).
            if (rules[key] && value !== undefined && !this.isPresenceOnlyPredicate(value)) {
                guards.push(this.nullSafeConditions(modelName, PrismaService._buildConditions(rules[key].visibleOnlyWhen, user)));
            }
            const relation = this.getRelation(modelName, key);
            if (!relation || !value || typeof value !== 'object') {
                scoped[key] = value; // scalar filter, or a to-one presence check (`rel: null`)
                continue;
            }

            const conditions = this.relationReadConditions(modelName, key, relation, userRole, user, 'where');
            scoped[key] = PrismaService.mapRelationFilter(relation, value, (op, filter) => {
                if (filter === null) return null; // `is: null` / `isNot: null`
                const inner = this.scopeRelationFilters(relation.model, userRole, filter, user);
                if (!conditions) return inner;
                return op === 'every' ? {OR: [inner, {NOT: conditions}]} : {AND: [inner, conditions]};
            });
        }
        return guards.length ? {AND: [...guards, scoped]} : scoped;
    }

    /**
     * Applies `fn` to the filter inside each operator of a relation filter
     * (`some`/`every`/`none`, `is`/`isNot`), or to the to-one shorthand
     * (`rel: { ... }` ≡ `rel: { is: { ... } }`) as a whole, with no operator.
     */
    private static mapRelationFilter(relation: {relation: string}, value: any, fn: (op: string | null, filter: any) => any): any {
        const hasOperators = value && typeof value === 'object'
            && (relation.relation === 'hasMany' || 'is' in value || 'isNot' in value);
        if (!hasOperators) return fn(null, value);
        return Object.fromEntries(Object.keys(value).map((op) => [op, fn(op, value[op])]));
    }

    /**
     * The resolved read conditions a relation's target imposes on this role, or
     * `undefined` when it imposes none (exposed model or 'ALL'). A target with no
     * read rule is rejected, naming the relation as the field being filtered or
     * ordered by.
     */
    private relationReadConditions(
        modelName: string,
        field: string,
        relation: {model: string, relation: string},
        userRole: string,
        user: any,
        kind: 'where' | 'orderBy' | 'select',
    ): any {
        const exposedModels = (CorePrismaContext.getStore()?.exposedModels || []).map((m: string) => m.toLowerCase());
        if (exposedModels.includes(relation.model.toLowerCase())) return undefined;
        const permissions = this.normalizedPermissionsConfig[relation.model.toLowerCase()]?.[userRole] || {};
        const action = relation.relation === 'belongsTo' ? 'findFirst' : 'findMany';
        const relatedPermissions = this.selectPermission(permissions, action, relation.model, userRole);
        if (!relatedPermissions) {
            if (kind !== 'select') this.throwUnreadableFilterField(modelName, field, userRole, kind);
            console.debug(`No permissions found for action '${relation.model}.${action}()' on role ${userRole}`)
            throw new HttpException('Missing permissions on model ' + relation.model, HttpStatus.FORBIDDEN);
        }
        if (relatedPermissions === 'ALL') return undefined;
        return this.nullSafeConditions(relation.model, PrismaService._buildConditions(relatedPermissions.conditions, user));
    }

    /**
     * Makes a condition strictly true/false in SQL. A comparison on a nullable
     * column is NULL (not false) when the column is NULL, and under a negation
     * (`isNot`, `NOT`, which Prisma inlines for to-one relations) NULL stays NULL
     * — so the outcome would depend on the rest of the filter. Guarding each
     * such comparison with `IS NOT NULL` turns NULL into false; where the
     * condition is used positively the result is unchanged.
     */
    private nullSafeConditions(modelName: string, clause: any): any {
        if (Array.isArray(clause)) return clause.map((c) => this.nullSafeConditions(modelName, c));
        if (!clause || typeof clause !== 'object') return clause;

        const nullableFields: string[] = this.fieldConfigs[modelName.toLowerCase()].nullableFields;
        const guards: any[] = [];
        const safe: any = {};
        for (const key of Object.keys(clause)) {
            const value = clause[key];
            if (key === 'AND' || key === 'OR' || key === 'NOT') {
                safe[key] = this.nullSafeConditions(modelName, value);
                continue;
            }
            const relation = this.getRelation(modelName, key);
            if (relation) {
                safe[key] = PrismaService.mapRelationFilter(relation, value, (_op, filter) => this.nullSafeConditions(relation.model, filter));
                continue;
            }
            if (nullableFields.includes(key) && value !== undefined && !this.isPresenceOnlyPredicate(value)) {
                guards.push({[key]: {not: null}});
            }
            safe[key] = value;
        }
        return guards.length ? {AND: [...guards, safe]} : safe;
    }

    /** Recursively assert no omitted field is referenced in a where/orderBy clause. */
    private assertClauseFieldsReadable(
        modelName: string,
        userRole: string,
        clause: any,
        kind: 'where' | 'orderBy' | 'cursor',
    ): void {
        if (Array.isArray(clause)) {
            for (const c of clause) this.assertClauseFieldsReadable(modelName, userRole, c, kind);
            return;
        }
        if (!clause || typeof clause !== 'object') return;

        const omit = new Set(this.getFieldsToOmit(modelName, userRole));
        // `fields` columns are scoped on a where (scopeRelationFilters); an order or a cursor can't be.
        if (kind !== 'where') Object.keys(this.fieldRules(modelName, userRole)).forEach((field) => omit.add(field));
        for (const key of Object.keys(clause)) {
            const value = clause[key];

            // Logical grouping — recurse on the same model.
            if (key === 'AND' || key === 'OR' || key === 'NOT') {
                this.assertClauseFieldsReadable(modelName, userRole, value, kind);
                continue;
            }
            // Direct reference to a field the role can't read.
            if (omit.has(key)) {
                // A presence/nullness check (`field: null`, `{ equals: null }`,
                // `{ not: null }`) reveals only whether the value is set — not the
                // value — so it stays allowed on a `where` (the `hasX` / `isDeleted`
                // pattern, without needing BYPASS_OMISSION). Any value-bearing
                // operator, and every `orderBy`/`distinct`, still leaks and is rejected.
                if (kind === 'where' && this.isPresenceOnlyPredicate(value)) continue;
                this.throwUnreadableFilterField(modelName, key, userRole, kind);
            }
            // Relation — recurse into the related model (unwrapping list/one filters).
            const relation = this.getRelation(modelName, key);
            if (relation) {
                const wrappers = ['some', 'every', 'none', 'is', 'isNot'];
                const wrapped =
                    value && typeof value === 'object' ? wrappers.filter((w) => w in value) : [];
                if (wrapped.length) {
                    for (const w of wrapped) this.assertClauseFieldsReadable(relation.model, userRole, value[w], kind);
                } else {
                    this.assertClauseFieldsReadable(relation.model, userRole, value, kind);
                }
            } else if (kind === 'cursor' && value && typeof value === 'object' && !this.getScalarFields(modelName).includes(key)) {
                // Compound unique key (`a_b: { a, b }`) — its entries are this model's columns.
                this.assertClauseFieldsReadable(modelName, userRole, value, kind);
            }
            // Otherwise: a readable scalar field. Its value is an operator object
            // (where) or 'asc'/'desc' (orderBy) — not a field map, so no recursion.
        }
    }

    /**
     * True when a `where` predicate on a field checks only presence/nullness —
     * `field: null`, `{ equals: null }`, `{ not: null }` — and therefore reveals
     * whether the value is set but never the value itself. Anything with a
     * non-null literal (`equals: "x"`, `contains`, `gt`, `in`, …) is not
     * presence-only.
     */
    private isPresenceOnlyPredicate(value: any): boolean {
        if (value === null) return true; // `field: null`
        if (typeof value !== 'object' || Array.isArray(value)) return false; // a literal value
        const keys = Object.keys(value);
        if (keys.length === 0) return false;
        return keys.every((k) => (k === 'equals' || k === 'not') && value[k] === null);
    }

    private throwUnreadableFilterField(modelName: string, field: string, userRole: string, kind: string): never {
        throw new HttpException(
            `Cannot ${kind === 'orderBy' ? 'order by' : kind === 'cursor' ? 'page by' : 'filter by'} '${modelName}.${field}' — not readable by role ${userRole}.`,
            HttpStatus.FORBIDDEN,
        );
    }

    private applyWhereConditions(
        modelName: string,
        userRole: string,
        args: any,
        user: any,
        action: string | symbol,
    ): any {
        if (!args) {
            args = {};
        }
        const belongsToQueue = [];

        const permissionsConfig = this.normalizedPermissionsConfig;
        const normalizedName = modelName.toLowerCase().trim();
        const permissions = permissionsConfig[normalizedName]?.[userRole];

        let actionPermissions;

        // If model is exposed, permissions is ALL
        const exposedModels = (CorePrismaContext.getStore()?.exposedModels || []).map((m: string) => m.toLowerCase());
        if (exposedModels.includes(modelName.toLowerCase())) {
            actionPermissions = 'ALL';
        } else {
            if (!permissions) {
                throw new HttpException(`No permissions found for model '${modelName}' and role ${userRole}`, HttpStatus.FORBIDDEN);
            }

            actionPermissions = this.selectPermission(permissions, action.toString(), modelName, userRole);

            if (!actionPermissions) {
                console.debug(`No permissions found for action '${modelName}.${String(action)}()' on role ${userRole}`)
                throw new HttpException('Missing permissions on model ' + modelName, HttpStatus.FORBIDDEN);
            }
        }

        // `include` reaches here only when field omission was bypassed (omission
        // rewrites it to `select`); relations are filtered the same either way.
        const projection = args.select ?? args.include;
        if (projection) {
            for (const field of Object.keys(projection)) {
                // If field is relation
                let relation = this.getRelation(modelName, field);
                if (!relation) {
                    if (field === '_count') {
                        projection[field] = this.applyCountConditions(modelName, userRole, projection[field], user);
                    }
                    continue;
                }
                if (projection[field] === false) continue; // not selected, so not read

                if (relation.relation === 'belongsTo') {
                    this.debug(`Found 1:1 / *:1 (belongsTo) relation to model '${relation.model}' from model '${modelName}' via field '${field}'. Filter will be applied to main conditions...`);

                    // findFirst permissions for related model
                    const relatedPermissions = this.selectPermission(permissionsConfig[relation.model.toLowerCase()]?.[userRole] || {}, 'findFirst', relation.model, userRole)

                    let conditions: any;

                    // If model is exposed, do not apply conditions
                    if (exposedModels.includes(relation.model.toLowerCase())) {
                        this.debug(`Related model '${relation.model}' is exposed via @Permission() decorator. Skipping conditions for action '${String(action)}' on role ${userRole}.`);
                    } else {
                        if (!relatedPermissions) {
                            console.debug(`No permissions found for action '${relation.model}.${String(action)}()' on role ${userRole}`)
                            throw new HttpException('Missing permissions on model ' + relation.model, HttpStatus.FORBIDDEN);
                        }

                        if (relatedPermissions === 'ALL') {
                            this.debug(`Related model '${relation.model}' has 'ALL' permissions for action '${String(action)}' on role ${userRole}. No conditions to apply.`);
                        } else {
                            conditions = PrismaService._buildConditions(relatedPermissions?.conditions, user);
                        }
                    }

                    // Relations selected below this one are filtered too: the related
                    // model's own to-one conditions merge into `conditions` (Prisma
                    // can't take a `where` on a to-one selection), and its to-many
                    // relations are filtered in place.
                    const nested = projection[field];
                    if (nested && typeof nested === 'object' && (nested.select || nested.include)) {
                        conditions = this.applyWhereConditions(
                            relation.model,
                            userRole,
                            {select: nested.select, include: nested.include},
                            user,
                            'findFirst',
                        ).where;
                    }

                    if (conditions) {
                        belongsToQueue.push({
                            field,
                            relation,
                            conditions,
                        });
                    }
                    continue;
                }

                this.debug(`Found 1:N / N:N (hasMany) relation to model '${relation.model}' from model '${modelName}' via field '${field}'. Applying filter to the relation...`);

                /* Where conditions are applied outside of the select. Example as per documentation:
                const result = await prisma.user.findFirst({
                  select: {
                    posts: {
                      where: {
                        published: false,
                      },
                      select: {
                        title: true,
                      },
                    },
                  },
                })
                 */

                if (projection[field] === true) {
                    projection[field] = {};
                }

                // findMany permissions for related model
                projection[field].where = this.applyWhereConditions(relation.model, userRole, projection[field], user, 'findMany').where;
                if (projection[field].select) {
                    delete projection[field].select.where;
                }
            }
        }

        // Ordering by a related to-one field applies that model's read rules the
        // same way selecting it does: rows whose related record isn't readable
        // don't take part in the ordering.
        belongsToQueue.push(...this.orderByRelationConditions(modelName, userRole, args.orderBy, user));

        if (belongsToQueue?.length > 0) {
            this.debug(`Merging belongsTo relation conditions into main ${modelName}.`, 'warn');
        }

        for (const entry of belongsToQueue) {
            const {conditions, field, relation} = entry;

            this.debug(`Merging conditions for belongsTo relation field '${field}': ${JSON.stringify(conditions)}`, 'info');

            if (!args.where)
                args.where = {};

            args.where = PrismaService.mergeToOneConditions(args.where, field, relation, conditions);
        }

        // If model is exposed, do not apply conditions
        if (exposedModels.includes(modelName.toLowerCase())) {
            this.debug(`Model '${modelName}' is exposed via @Permission() decorator. Skipping conditions for action '${String(action)}' on role ${userRole}.`);
            return args;
        }

        if (actionPermissions === 'ALL') {
            this.debug(`No conditions to apply for '${modelName}.${String(action)}()' on role ${userRole}`);
            return args;
        }

        const whereClause = PrismaService._buildConditions(actionPermissions.conditions, user);

        this.debug(`Applying where conditions for '${modelName}.${String(action)}()' on role ${userRole}: ${JSON.stringify(whereClause)}`);

        if (!args.where) {
            args.where = whereClause;
        } else {
            args.where = {AND: [args.where, whereClause]};
        }

        return args;
    }

    /**
     * Merges a to-one relation's read conditions into a `where`. If the relation
     * is optional, rows where it is null are kept.
     */
    private static mergeToOneConditions(where: any, field: string, relation: {isRequired: boolean}, conditions: any): any {
        if (relation.isRequired === false) {
            return {
                OR: [
                    {
                        ...where,
                        [field]: {
                            AND: [
                                where[field] ?? {},
                                conditions
                            ]
                        }
                    },
                    {
                        ...where,
                        [field]: {is: null}
                    }
                ]
            };
        }
        return {
            ...where,
            [field]: {
                AND: [
                    where[field] ?? {},
                    conditions
                ]
            }
        };
    }

    /**
     * The to-one read conditions an `orderBy` brings in: ordering by a related
     * field (at any depth) requires that related record to be readable, like
     * selecting it. Ordering by a to-many relation's count is only allowed when
     * the related model is fully readable (a count can't be scoped).
     */
    private orderByRelationConditions(modelName: string, userRole: string, orderBy: any, user: any): any[] {
        const entries: any[] = [];
        for (const clause of ([] as any[]).concat(orderBy ?? [])) {
            if (!clause || typeof clause !== 'object') continue;
            for (const field of Object.keys(clause)) {
                const relation = this.getRelation(modelName, field);
                if (!relation) continue;
                let conditions = this.relationReadConditions(modelName, field, relation, userRole, user, 'orderBy');
                if (relation.relation !== 'belongsTo') {
                    if (conditions) this.throwUnreadableFilterField(modelName, field, userRole, 'orderBy');
                    continue;
                }
                const deeper = this.orderByRelationConditions(relation.model, userRole, clause[field], user)
                    .reduce((where, e) => PrismaService.mergeToOneConditions(where, e.field, e.relation, e.conditions), {});
                if (Object.keys(deeper).length) conditions = conditions ? {AND: [conditions, deeper]} : deeper;
                if (conditions) entries.push({field, relation, conditions});
            }
        }
        return entries;
    }

    /**
     * Scopes a `_count` selection: each counted to-many relation only counts the
     * related rows the role can read. A relation into a model with no read rule
     * is rejected, as selecting it would be. Left untouched when nothing needs
     * scoping.
     */
    private applyCountConditions(modelName: string, userRole: string, value: any, user: any): any {
        const relationFields = this.fieldConfigs[modelName.toLowerCase()].relationFields;
        // `_count: true` counts every to-many relation.
        const counted = value === true
            ? Object.fromEntries(Object.keys(relationFields).filter((f) => relationFields[f].relation === 'hasMany').map((f) => [f, true]))
            : value?.select;
        if (!counted || typeof counted !== 'object') return value;

        let scoped: any;
        for (const field of Object.keys(counted)) {
            const relation = this.getRelation(modelName, field);
            if (!relation || !counted[field]) continue;
            const conditions = this.relationReadConditions(modelName, field, relation, userRole, user, 'select');
            if (!conditions) continue;
            const entry = typeof counted[field] === 'object' ? counted[field] : {};
            scoped = scoped ?? {...counted};
            scoped[field] = {...entry, where: entry.where ? {AND: [entry.where, conditions]} : conditions};
        }
        if (!scoped) return value;
        return {...(value === true ? {} : value), select: scoped};
    }

    /**
     * Writes the rule's `set` values into every row of a write's `data`,
     * overriding what the client sent (placeholders such as `$USER_ID` are
     * resolved). Runs before the write is authorized, so the set values are
     * checked like any other: against the create `conditions`, and a set
     * foreign key against its `connect` rule.
     */
    private applySetValues(modelName: string, userRole: string, data: any, user: any, action: string): void {
        const exposedModels = (CorePrismaContext.getStore()?.exposedModels || []).map((m: string) => m.toLowerCase());
        if (exposedModels.includes(modelName.toLowerCase())) return;
        const permissions = this.normalizedPermissionsConfig[modelName.toLowerCase()]?.[userRole] || {};
        const set = this.selectPermission(permissions, action, modelName, userRole)?.set;
        if (!set) return;
        const values = PrismaService._buildConditions(set, user);
        for (const row of Array.isArray(data) ? data : [data]) {
            if (row && typeof row === 'object') Object.assign(row, values);
        }
    }

    /**
     * Enforces permission `conditions` on `create` / `createMany`.
     *
     * Conditions cannot be pushed into a `WHERE` on insert, so instead we verify
     * the incoming data *would* satisfy them — i.e. a `findFirst` with those
     * conditions would return the new row. Own-scalar fields are checked against
     * `data`; relation conditions are checked by looking up the referenced parent
     * (which lets Prisma evaluate arbitrarily-nested relation conditions for us).
     *
     * Also default-denies: create is only allowed for a role/action that has an
     * explicit permission (or 'ALL'), mirroring find/update/delete. Framework
     * flows that must create without a permission (registration, sessions,
     * tokens) pass BYPASS_FILTERING and never reach here.
     *
     * Fails **closed**: throws on a violation and on any condition shape it
     * cannot evaluate, rather than silently allowing the insert.
     */
    private async enforceCreateConditions(
        modelName: string,
        userRole: string,
        params: any,
        user: any,
        action: string,
        trustedFk?: string,
    ): Promise<void> {
        const normalizedName = modelName.toLowerCase().trim();

        const exposedModels = (CorePrismaContext.getStore()?.exposedModels || []).map((m: string) => m.toLowerCase());
        if (exposedModels.includes(normalizedName)) return;

        const permissions = this.normalizedPermissionsConfig[normalizedName]?.[userRole];
        if (!permissions) {
            throw new HttpException(
                `No permissions defined for role ${userRole} on model '${modelName}' — create is denied by default. Define a '${action}' permission (or 'ALL').`,
                HttpStatus.FORBIDDEN,
            );
        }

        const actionPermissions = permissions[action] ?? permissions['create'];
        if (!actionPermissions) {
            throw new HttpException(
                `Role ${userRole} has no '${action}' permission on model '${modelName}' — create is denied. Define it (or 'ALL').`,
                HttpStatus.FORBIDDEN,
            );
        }
        if (actionPermissions === 'ALL') return;

        const conditions = (actionPermissions as any).conditions;
        if (!conditions) return; // permission defined but no conditions (e.g. `set` only) → allow

        const condObj = Array.isArray(conditions) ? {AND: conditions} : conditions;
        const resolved = PrismaService._buildConditions(condObj, user);

        const data = params?.data;
        const rows = Array.isArray(data) ? data : [data ?? {}];

        for (const row of rows) {
            const effectiveRow = this.resolveConnectForeignKeys(modelName, row || {});
            const ok = await this.matchesCreateConditions(resolved, effectiveRow, modelName, trustedFk);
            if (!ok) {
                throw new ForbiddenException(
                    `Not allowed to create ${modelName}: the record does not satisfy the '${action}' permission conditions for role ${userRole}.`,
                );
            }
        }
    }

    /**
     * Authorizes every relation a write establishes. Relationship authorization
     * lives entirely in the `connect` action — create conditions judge a model's
     * own scalar fields only.
     *
     * Runs on create AND update: a `create` can nest relation writes or set raw
     * FKs; an `updateMany` (scalar-only) can re-point a raw FK. Both go through
     * the same `connect` authorization.
     *
     *   - A raw scalar foreign key (`courseId: 7`) → the target's `connect` rule.
     *   - `relation: { connect }` → the target's `connect` rule. `connect` is a
     *     DEDICATED action: being allowed to READ a record does not authorize
     *     associating it.
     *   - `relation: { create }` → the target's `create` rule (recurses, so deeper
     *     nesting is authorized too). Every other nested operator is rejected.
     *
     * The one exception is `trustedFk`: the scalar FK that points back to the row
     * we're nested under. Prisma fills it at write time and the parent already
     * authorized itself, so it is not re-checked.
     */
    private async enforceNestedWrites(modelName: string, data: any, user: any, userRole: string, trustedFk?: string): Promise<void> {
        if (!data || typeof data !== 'object') return;
        const rows = Array.isArray(data) ? data : [data];
        for (const row of rows) {
            if (!row || typeof row !== 'object') continue;
            for (const key of Object.keys(row)) {
                const relation = this.getRelation(modelName, key);
                if (relation) {
                    const ops = row[key];
                    if (!ops || typeof ops !== 'object') continue; // e.g. an explicit `null` disconnect-by-omission
                    await this.enforceNestedRelationOps(relation.model, key, ops, user, userRole, modelName, relation.relationName);
                    continue;
                }
                // A plain scalar that happens to be a belongsTo foreign key still
                // establishes an association — authorize it against the target's
                // `connect` rule, exactly as the `connect` form would be.
                const fk = this.foreignKeyColumn(modelName, key);
                if (!fk) continue; // ordinary scalar
                if (key === trustedFk) continue; // back-reference to the nesting parent — trusted
                let value = row[key];
                if (value && typeof value === 'object' && 'set' in value) value = (value as any).set; // update form: { set: x }
                if (value === undefined || value === null) continue;
                await this.assertConnectAllowed(modelName, fk.field, fk.model, {[fk.foreignKey]: value}, user, userRole);
            }
        }
    }

    /** Authorizes each operator inside one relation's nested-write object. */
    private async enforceNestedRelationOps(
        relatedModel: string,
        field: string,
        ops: any,
        user: any,
        userRole: string,
        parentModel: string,
        parentRelationName?: string,
    ): Promise<void> {
        const ALLOWED = ['create', 'connect'];
        // The child's FK back to the parent it's nested under is filled by Prisma
        // and trusted; skip it when authorizing the child's own relations.
        const backFk = this.backReferenceFk(relatedModel, parentModel, parentRelationName);
        for (const op of Object.keys(ops)) {
            if (!ALLOWED.includes(op)) {
                throw new ForbiddenException(
                    `Nested '${op}' on relation '${field}' of ${parentModel} is not supported through the data-access proxy. ` +
                        `Only ${ALLOWED.join(' / ')} are permitted; perform other nested writes in an explicit endpoint with its own authorization.`,
                );
            }
            const value = ops[op];
            const items = Array.isArray(value) ? value : [value];
            if (op === 'create') {
                for (const child of items) {
                    this.applySetValues(relatedModel, userRole, child, user, 'create');
                    await this.enforceCreateConditions(relatedModel, userRole, {data: child}, user, 'create', backFk);
                    await this.enforceNestedWrites(relatedModel, child, user, userRole, backFk);
                }
            } else {
                for (const target of items) {
                    await this.assertConnectAllowed(parentModel, field, relatedModel, target, user, userRole);
                }
            }
        }
    }

    /** If `column` is the scalar FK backing a belongsTo relation, returns that relation's field + target. */
    private foreignKeyColumn(modelName: string, column: string): {field: string, model: string, foreignKey: string} | null {
        const rels = this.fieldConfigs[modelName.toLowerCase()]?.relationFields || {};
        for (const key of Object.keys(rels)) {
            const r = rels[key];
            if (r.relation === 'belongsTo' && r.referencingColumn === column && r.foreignKey) {
                return {field: key, model: r.model, foreignKey: r.foreignKey};
            }
        }
        return null;
    }

    /** The child's scalar FK column pointing back to the parent it's nested under (trusted). */
    private backReferenceFk(childModel: string, parentModel: string, parentRelationName?: string): string | undefined {
        const rels = this.fieldConfigs[childModel.toLowerCase()]?.relationFields || {};
        const candidates = Object.keys(rels)
            .map(key => rels[key])
            .filter((r: any) => r.relation === 'belongsTo' && r.referencingColumn && r.model.toLowerCase() === parentModel.toLowerCase());
        // Prisma pairs the two sides of a relation by `relationName`; use it to
        // disambiguate when the child has several relations to the same parent.
        if (parentRelationName) {
            const exact = candidates.find((r: any) => r.relationName === parentRelationName);
            if (exact) return exact.referencingColumn;
        }
        return candidates.length === 1 ? candidates[0].referencingColumn : undefined;
    }

    /**
     * Authorizes attaching `relatedModel` (identified by `where`) through the
     * `field` relation on `sourceModel`. Two rules can apply, evaluated against
     * the candidate target row:
     *   - a relation-scoped rule on the source (`sourceModel[role].relations[field].connect`)
     *   - the target model's own rule (`relatedModel[role].connect`)
     * When both exist they are ANDed (the relation rule can only strengthen).
     * When only one exists it stands alone; when neither exists, default-deny.
     */
    private async assertConnectAllowed(
        sourceModel: string,
        field: string,
        relatedModel: string,
        where: any,
        user: any,
        userRole: string,
    ): Promise<void> {
        const normalizedName = relatedModel.toLowerCase().trim();
        const exposedModels = (CorePrismaContext.getStore()?.exposedModels || []).map((m: string) => m.toLowerCase());
        if (exposedModels.includes(normalizedName)) return;

        const relationRule = this.normalizedPermissionsConfig[sourceModel.toLowerCase().trim()]?.[userRole]?.['relations']?.[field]?.connect;
        const targetRule = this.normalizedPermissionsConfig[normalizedName]?.[userRole]?.['connect'];

        if (relationRule === undefined && targetRule === undefined) {
            throw new ForbiddenException(
                `Not allowed to connect ${relatedModel} (via '${field}'): role ${userRole} has no 'connect' permission. ` +
                    `Declare it on ${relatedModel}.${userRole}.connect, or scope it to this relation with ${sourceModel}.${userRole}.relations.${field}.connect.`,
            );
        }

        // Collect the conditions each applicable rule imposes; an 'ALL' or
        // condition-less rule constrains nothing. The target must satisfy every
        // collected condition (AND — the relation rule strengthens the target's).
        const conditionSets: any[] = [];
        for (const rule of [relationRule, targetRule]) {
            if (rule === undefined || rule === 'ALL') continue;
            const conditions = (rule as any).conditions;
            if (conditions) {
                conditionSets.push(PrismaService._buildConditions(Array.isArray(conditions) ? {AND: conditions} : conditions, user));
            }
        }
        if (conditionSets.length === 0) return; // every applicable rule is unconditional

        const delegate = relatedModel.charAt(0).toLowerCase() + relatedModel.slice(1);
        const client: any = RequestContext.currentContext?.req.prisma || this.rawClient;
        const found = await client[delegate].findFirst({where: {AND: [where || {}, ...conditionSets]}});
        if (!found) {
            throw new ForbiddenException(
                `Not allowed to connect ${relatedModel} (via '${field}'): the target does not satisfy the 'connect' permission conditions for role ${userRole}.`,
            );
        }
    }

    /**
     * True only in an explicit local-development environment. Deliberately NOT
     * `!== 'production'` — staging and other envs should behave like production
     * (no extra diagnostic queries/logging). Only `development` / `dev` opt in.
     */
    private isDevMode(): boolean {
        const env = process.env.NODE_ENV;
        return env === 'development' || env === 'dev';
    }

    /**
     * Dev-only diagnostic. After a create that passed its create-conditions,
     * checks whether the new row also satisfies the model's *find* conditions —
     * if not, the creator can't read it back (create rule broader than find
     * rule). Logs a warning; never affects the create. Runs only in development
     * (gated by the caller).
     */
    private async warnIfCreatedRowNotFindable(modelKey: string, userRole: string, created: any): Promise<void> {
        try {
            if (!created || created.id === undefined || created.id === null) return;

            const permissions = this.normalizedPermissionsConfig[modelKey.toLowerCase()]?.[userRole];
            const findPerm = permissions?.['findFirst'] ?? permissions?.['findMany'];
            if (!findPerm || findPerm === 'ALL' || !(findPerm as any).conditions) return;

            const found = await (this.prismaClient as any)[modelKey].findFirst({where: {id: created.id}});
            if (!found) {
                console.warn(
                    '\x1b[33m',
                    `[APPX-CORE PRISMA] Created ${modelKey} id=${created.id} as role ${userRole}, but it does not satisfy the model's find conditions — the creator cannot read it back. Ensure your find conditions are at least as permissive as your create conditions.`,
                    '\x1b[0m',
                );
            }
        } catch {
            // Dev diagnostic only — never let it affect the create.
        }
    }

    /**
     * A view of a create `row` where a belongsTo relation given via `connect`
     * (`owner: { connect: { id } }`) is also surfaced as its scalar FK (`ownerId`),
     * so scalar-FK create conditions match either payload form. Metadata-driven
     * (`referencingColumn`/`foreignKey`); resolvable only when the connect targets
     * the referenced column. Explicit scalar wins; row is not mutated.
     */
    private resolveConnectForeignKeys(modelName: string, row: any): any {
        if (!row || typeof row !== 'object') return row;
        let effective = row;
        for (const key of Object.keys(row)) {
            const relation = this.getRelation(modelName, key);
            if (!relation || relation.relation !== 'belongsTo') continue;
            if (!relation.referencingColumn || !relation.foreignKey) continue;
            if (row[relation.referencingColumn] !== undefined) continue; // explicit scalar wins

            const connectWhere = row[key]?.connect;
            const fk = connectWhere?.[relation.foreignKey];
            if (fk === undefined) continue;

            if (effective === row) effective = {...row};
            effective[relation.referencingColumn] = fk;
        }
        return effective;
    }

    /**
     * Evaluates a (placeholder-resolved) create condition against a to-be-created
     * row. Create conditions judge the model's OWN scalar fields only — a clause
     * that reaches into a relation is not a create concern (relationships are
     * authorized by the target's `connect` rule) and is skipped here; the config
     * validator rejects such clauses at boot. `trustedFk` (the back-reference to a
     * same-request nesting parent) is likewise skipped — its value doesn't exist yet.
     * Also judges `fields` (`visibleOnlyWhen`) rules against a returned row.
     */
    private async matchesCreateConditions(cond: any, row: any, modelName: string, trustedFk?: string): Promise<boolean> {
        for (const key of Object.keys(cond)) {
            const val = cond[key];

            if (key === 'AND') {
                const arr = Array.isArray(val) ? val : [val];
                for (const c of arr) if (!(await this.matchesCreateConditions(c, row, modelName, trustedFk))) return false;
                continue;
            }
            if (key === 'OR') {
                const arr = Array.isArray(val) ? val : [val];
                let any = false;
                for (const c of arr) if (await this.matchesCreateConditions(c, row, modelName, trustedFk)) { any = true; break; }
                if (!any) return false;
                continue;
            }
            if (key === 'NOT') {
                const arr = Array.isArray(val) ? val : [val];
                for (const c of arr) if (await this.matchesCreateConditions(c, row, modelName, trustedFk)) return false;
                continue;
            }

            if (key === trustedFk) continue; // parent link, filled by Prisma — trusted
            if (this.getRelation(modelName, key)) continue; // relation clause — authorized via `connect`, not here

            if (!this.matchesCreateScalar(row[key], val, key, modelName)) return false;
        }
        return true;
    }

    /** Evaluates a scalar-field condition (value or Prisma operator object) against the row's value. */
    private matchesCreateScalar(actual: any, cond: any, key: string, modelName: string): boolean {
        if (cond === null) return actual === null || actual === undefined;
        if (cond instanceof Date || typeof cond !== 'object') return actual === cond;

        for (const op of Object.keys(cond)) {
            const opv = cond[op];
            switch (op) {
                case 'equals': if (actual !== opv) return false; break;
                case 'not': if (actual === opv) return false; break;
                case 'in': if (!Array.isArray(opv) || !opv.includes(actual)) return false; break;
                case 'notIn': if (Array.isArray(opv) && opv.includes(actual)) return false; break;
                case 'lt': if (!(actual < opv)) return false; break;
                case 'lte': if (!(actual <= opv)) return false; break;
                case 'gt': if (!(actual > opv)) return false; break;
                case 'gte': if (!(actual >= opv)) return false; break;
                default:
                    throw new ForbiddenException(
                        `create on ${modelName}: unsupported operator '${op}' on field '${key}' in a create condition. Use a simpler condition or 'set'.`,
                    );
            }
        }
        return true;
    }

    /**
     * Builds dynamic conditions based on the type of clause (OR, AND, or field conditions).
     * Each condition is processed, and placeholders (like `$USER_ID`) are replaced with actual values.
     *
     * @param conditions - An array of clauses that define the conditions for the query.
     * @param user - The user object used to replace placeholders.
     * @returns The constructed `where` clause object.
     */
    public static _buildConditions(conditions: any[], user: any): any {
        const whereClause: Record<string, any> = {};

        if (!conditions) {
            return whereClause;
        }
        for (let field in conditions) {
            whereClause[field] = this.replacePlaceholders(
                conditions[field],
                user,
            );
        }

        return whereClause;
    }

    /**
     * Replaces placeholders (like `$USER_ID`) in the condition with actual values from the user object.
     * Handles conditions in the form of strings, arrays, or objects.
     *
     * @param condition - The condition that might contain placeholders.
     * @param user - The user object containing values like `id`.
     * @returns The condition with placeholders replaced by actual values.
     */
    private static replacePlaceholders(condition: any, user: any): any {
        if (condition === null) {
            return null;
        }

        if (typeof condition === 'string') {
            if (condition === '$USER_ID') {
                return user.id;
            }
            return condition;
        }

        if (Array.isArray(condition)) {
            return condition.map((item) => this.replacePlaceholders(item, user));
        }

        if (typeof condition === 'object') {
            const replaced: any = {};
            for (const key in condition) {
                replaced[key] = this.replacePlaceholders(condition[key], user);
            }
            return replaced;
        }

        return condition;
    }

    /**
     * The scalar (and enum) field names of a model, as derived from the Prisma
     * DMMF at bootstrap. Relations are excluded.
     *
     * Used by the GraphQL generic resolver to fetch the model's own columns even
     * when a query only selects a subset, so that a custom `@ResolveField` on the
     * model type (e.g. a signed-URL transform) can read its source column from
     * `@Parent()`. ABAC field omission still runs afterward at select-time, so a
     * `@Role`-restricted column is never actually fetched — callers only ever get
     * the readable projection.
     *
     * @param modelName - The model name (any casing; matched case-insensitively).
     * @returns The model's scalar field names, or `[]` if the model is unknown.
     */
    getScalarFields(modelName: string): string[] {
        return this.fieldConfigs[modelName.toLowerCase()]?.scalarFields ?? [];
    }

    /**
     * The columns of a model with a `/// @Role(...)` annotation — hidden from at
     * least one role. Used by the GraphQL module to resolve them `null` when omitted.
     *
     * @param modelName - The model name (any casing; matched case-insensitively).
     * @returns The annotated field names, or `[]` if the model is unknown.
     */
    getRoleRestrictedFields(modelName: string): string[] {
        return Object.keys(this.fieldConfigs[modelName.toLowerCase()]?.fieldConfig ?? {});
    }

    /**
     * Retrieves the list of fields to omit based on the user's role.
     * It checks the field configurations stored in `fieldConfigs` and compares them against the role.
     *
     * @param modelName - The name of the model being queried.
     * @param role - The role of the user making the request.
     * @returns An array of field names to be omitted from the query.
     */
    private getFieldsToOmit(modelName: string, role: string): string[] {
        const modelInfo = this.fieldConfigs[modelName.toLowerCase()] || {};
        const fieldConfig = modelInfo.fieldConfig || {};
        const omitFields = Object.entries(fieldConfig)
            .filter(([_, roles]) => !(roles as string[]).includes(role))
            .map(([field]) => field);
        this.debug(`Fields to omit on '${modelName}', based on schema @Role() configuration: ${omitFields.join(', ')}`);
        return omitFields;
    }

    /**
     * Builds the `select` object for Prisma queries, omitting fields based on the user's role.
     * It handles both scalar fields and relation fields.
     *
     * @param modelName - The name of the model being queried.
     * @param omitFields - A list of fields to omit based on the user's role.
     * @param includeRelations - The relations to include in the query.
     * @param defaultSelect - The select object provided in the query arguments.
     * @param userRole - The role of the user making the request.
     * @returns A `select` object for Prisma queries.
     */
    private buildSelectFields(
        modelName: string,
        omitFields: string[],
        includeRelations: any,
        defaultSelect: any,
        userRole: string,
    ): any {
        const modelInfo = this.fieldConfigs[modelName.toLowerCase()];
        if (!modelInfo) {
            return {};
        }

        let {scalarFields, relationFields} = modelInfo;
        const selectFields: Record<string, any> = {};

        // If defaultSelect is provided, only include those fields
        if (defaultSelect) {
            // Use default select but separate scalar and relation fields. If not in any, consider relation
            scalarFields = Object.keys(defaultSelect).filter((field) => modelInfo.scalarFields.includes(field));
            relationFields = Object.keys(defaultSelect).filter((field) => !modelInfo.scalarFields.includes(field) || field === '_count').reduce((acc, field) => {
                acc[field] = defaultSelect[field];
                return acc;
            }, {} as Record<string, any>);

            // Merge with includeRelations if any
            if (Object.keys(relationFields).length > 0) {
                includeRelations = {...(includeRelations || {}), ...relationFields};
            }
        }

        for (const field of scalarFields) {
            if (!omitFields.includes(field)) {
                selectFields[field] = true;
            }
        }
        if (includeRelations) {
            for (const relationKey in includeRelations) {
                if (!relationFields[relationKey] && relationKey !== '_count') continue;
                let includedArgs = includeRelations[relationKey];
                if (includedArgs === true) {
                    includedArgs = {};
                }

                let relatedSelectFields: {[key: string]: any} = {};
                if (relationKey === '_count') {
                    if (includedArgs.select) {
                        relatedSelectFields = includedArgs.select;
                        omitFields.forEach((field) => {
                            delete relatedSelectFields[field];
                        });
                    }
                } else {
                    const relatedModelName = this.getRelation(modelName, relationKey, true).model;

                    this.debug(`Found relation to model '${relatedModelName}' from model '${modelName}' via field '${relationKey}'. Generating select fields...`);

                    const relatedModelOmitFields = this.getFieldsToOmit(
                        relatedModelName,
                        userRole,
                    );
                    relatedSelectFields = this.buildSelectFields(
                        relatedModelName,
                        relatedModelOmitFields,
                        includedArgs.include || null,
                        includedArgs.select || null,
                        userRole,
                    );
                }

                if (Object.keys(relatedSelectFields).length > 0) {
                    // Keep the relation's own arguments (where, orderBy, take, …).
                    const {select: _select, include: _include, ...relationArgs} = includedArgs;
                    selectFields[relationKey] = {...relationArgs, select: relatedSelectFields};
                }
            }
        }

        return selectFields;
    }

    getRelation(parentModel: string, relatedField: string, throwOnNotFound?: true): {
        model: string,
        relation: string,
        foreignKey?: string,
        referencingColumn?: string,
        relationName?: string,
        isRequired: boolean
    }
    getRelation(parentModel: string, relatedField: string, throwOnNotFound = false): {
        model: string,
        relation: string,
        foreignKey?: string,
        referencingColumn?: string,
        relationName?: string,
        isRequired: boolean
    } | null {
        parentModel = parentModel.toLowerCase();

        const parent = this.fieldConfigs[parentModel];

        const relation = parent.relationFields[relatedField];
        if (!relation && throwOnNotFound)
            throw new Error(`Relation key ${relatedField} not found in model ${parentModel}`,);

        return relation;
    }

    selectPermission(permissions: any, action: string, modelName: string, userRole: string) {
        let actionPermissions = permissions[action];

        // If action is find* or count and there is no permission, coalesce to one of the find actions
        if (!actionPermissions && (action.startsWith('find') || action === 'count')) {
            if (permissions['findMany']) {
                this.debug(`Using 'findMany' permissions for '${action}' action on model '${modelName}' and role ${userRole}`, 'info');
                actionPermissions = permissions['findMany'];
            } else if (permissions['findFirst']) {
                this.debug(`Using 'findFirst' permissions for '${action}' action on model '${modelName}' and role ${userRole}`, 'info');
                actionPermissions = permissions['findFirst'];
            }
        }

        // A `*Many` action inherits the singular rule when not set explicitly
        // (updateMany → update, deleteMany → delete). `update()` / `delete()`
        // redirect to their `*Many` form, so this is what makes a config that
        // declares only `update` / `delete` apply to them.
        if (!actionPermissions && SINGULAR_ACTION[action] && permissions[SINGULAR_ACTION[action]]) {
            this.debug(`Using '${SINGULAR_ACTION[action]}' permissions for '${action}' action on model '${modelName}' and role ${userRole}`, 'info');
            actionPermissions = permissions[SINGULAR_ACTION[action]];
        }

        return actionPermissions;
    }
}
