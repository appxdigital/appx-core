import {ForbiddenException, HttpException, HttpStatus, Inject, Injectable} from '@nestjs/common';
import {Prisma, PrismaClient} from '@prisma/client';
import {PermissionsConfigType} from '../common/config/permissionsConfigTypes';
import {RequestContext} from "nestjs-request-context";
import type {PrismaClient as RuntimeClient} from '.prisma/client';
import {RuntimeDataModel} from "@prisma/client/runtime/edge";
import {Operation} from "@prisma/client/runtime/client";

type ModelKey = keyof RuntimeClient;

/** Extra options available on every model method */
export type CorePrismaOptions = {
    BYPASS_OMISSION?: boolean;
    BYPASS_FILTERING?: boolean;
};

/** Ops that this particular delegate actually exposes */
type AvailableOps<M extends ModelKey> = Extract<keyof RuntimeClient[M], Operation>;

/** Map "public" method names to the *underlying* method whose args we want */
type AliasMethodName<K extends PropertyKey> =
    K extends 'findUnique' ? 'findFirst'
        : K extends 'findUniqueOrThrow' ? 'findFirstOrThrow'
            : K extends 'delete' ? 'deleteMany'
                : K extends 'update' ? 'updateMany'
                    : K;

/** Narrow the aliased name to ops that exist on this delegate */
type AliasedKey<
    M extends ModelKey,
    K extends keyof RuntimeClient[M]
> = Extract<AliasMethodName<K>, AvailableOps<M>>;

/** The Prisma args type of the *aliased* method (Op defaults to the aliased op) */
type CorePrismaArguments<
    M extends ModelKey,
    K extends keyof RuntimeClient[M],
    Op extends Operation = AliasedKey<M, K>
> = Prisma.Args<RuntimeClient[M], Op>;

/** The return type of the *aliased* method as a Prisma Promise */
type AliasedReturn<
    M extends ModelKey,
    K extends keyof RuntimeClient[M],
    A extends CorePrismaArguments<M, K, Op>,
    Op extends Operation = AliasedKey<M, K>
> = Prisma.PrismaPromise<Prisma.Result<RuntimeClient[M], A, Op>>;

/**
 * Proxied per-model delegate:
 * - For each function key, accept (aliasedArgs, options?)
 * - Return the aliased method’s return type (specialized by the args)
 * - Non-function properties pass through as-is
 */
export type CorePrismaModel<M extends ModelKey> = {
    [K in keyof RuntimeClient[M]]: RuntimeClient[M][K] extends (...a: any[]) => any
        ? <A extends CorePrismaArguments<M, K>>(args?: A, options?: CorePrismaOptions) => AliasedReturn<M, K, A>
        : RuntimeClient[M][K];
};

/** Proxied Prisma client (every model becomes a ProxiedDelegate) */
export type CorePrismaClient = {
    [M in ModelKey]: CorePrismaModel<M>;
};

// If findUniqueOrThrow exists, then it is a Model and can be mapped back to its key
type DelegateKeyForModel<M> = {
    [K in keyof RuntimeClient]:
    RuntimeClient[K] extends {findUniqueOrThrow: (...a: any[]) => Promise<infer R>}
        ? (R extends M ? K : never)        // match by the “plain” return type
        : never
}[Extract<keyof RuntimeClient, string>];

export type CorePrismaModelByModel<M> = CorePrismaModel<Extract<DelegateKeyForModel<M>, keyof RuntimeClient>>;

@Injectable()
export class PrismaService {
    private fieldConfigs: Record<string, any> = {};
    prismaClient: PrismaClient;

    constructor(
        prismaClient: PrismaClient,
        @Inject('PERMISSIONS_CONFIG') private readonly permissionsConfig: PermissionsConfigType,
    ) {
        this.prismaClient = prismaClient;
        this.parseSchema();
        this.proxyModels();
    }

    $transaction<T>(fn: (prisma: Prisma.TransactionClient) => Promise<T>) {
        return this.prismaClient.$transaction(fn);
    }

    proxyModels() {
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
                                const contextModel = RequestContext.currentContext?.req.prisma?.[propKey] || model;
                                return async (params: any = {}, options?: CorePrismaOptions) => {
                                    /*
                                        Alias methods, to allow for where conditions to be applied properly
                                     */
                                    const aliases: {[key: string]: string} = {
                                        findUnique: 'findFirst',
                                        findUniqueOrThrow: 'findFirstOrThrow',
                                        delete: 'deleteMany',
                                        update: 'updateMany',
                                    }
                                    methodKey = aliases[methodKey.toString()] || methodKey;

                                    // delete, deleteMany, update and updateMany methods should not apply field omission because they are not selecting fields
                                    if (!options?.BYPASS_OMISSION && !['delete', 'deleteMany', 'update', 'updateMany', 'create', 'createMany'].includes(methodKey.toString()))
                                        params = this.applyFieldOmission(String(propKey), userRole, params);
                                    if (!options?.BYPASS_FILTERING && !['create', 'createMany'].includes(methodKey.toString())) {
                                        params = this.applyWhereConditions(String(propKey), userRole, params, user, methodKey);
                                    }
                                    if (methodKey === 'count' && !!params.select) {
                                        delete params.select;
                                    }
                                    return contextModel[methodKey](params);
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
        const modelName = (model as string).toLowerCase();

        const client = this.prismaClient as unknown as CorePrismaClient;

        if (modelName in client) {
            return client[modelName as keyof CorePrismaClient] as CorePrismaModel<M>;
        }

        throw new Error(`Model ${model.toString()} not found in PrismaClient.`);
    }

    get model(): CorePrismaClient {
        // Cast once so callers see the ProxiedClient surface
        const target = this.prismaClient as unknown as CorePrismaClient & RuntimeClient;

        return new Proxy(target, {
            get: (t, prop: string | symbol) => {
                // let symbols (e.g., util.inspect.custom) pass through untouched
                if (typeof prop === 'symbol') return (t as any)[prop];

                // runtime validation that the model exists
                if (prop in t) return (t as any)[prop];

                throw new Error(`Model ${String(prop)} does not exist on PrismaClient`);
            },
        });
    }

    get user(): RuntimeClient['user'] {
        return (this.prismaClient as unknown as CorePrismaClient).user;
    }

    get session(): RuntimeClient['session'] {
        return (this.prismaClient as unknown as CorePrismaClient).session;
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

            for (const field of fields) {
                let field_name = field.name;

                const fieldType = field.type;
                const commentPart = field.documentation || '';

                if (commentPart) {
                    const roleMatch = commentPart.match(/@Role\((.*?)\)/);
                    if (roleMatch) {
                        fieldConfig[field_name] = roleMatch[1].split(',').map(role => role.trim());
                    }
                }

                allFields.push(field_name);
                fieldTypes[field_name] = fieldType;

                if (field.kind === 'scalar' || field.kind === 'enum') {
                    scalarFields.push(field_name);
                } else {
                    relationFields[field_name] = {
                        model: field.type,
                        relation: field.isList ? 'hasMany' : 'belongsTo',
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
        const omitFields = this.getFieldsToOmit(modelName, userRole);
        if (!args) {
            args = {};
        }

        if (args.select) {
            omitFields.forEach((field) => {
                delete args.select[field];
            });
        } else if (args.include) {
            args.select = this.buildSelectFields(
                modelName,
                omitFields,
                args.include,
                userRole,
            );
            delete args.include;
        } else {
            args.select = this.buildSelectFields(
                modelName,
                omitFields,
                null,
                userRole,
            );
        }
        return args;
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

        if (args.select) {
            for (const field of Object.keys(args.select)) {
                let relation = this.getRelationType(modelName, field);
                if (!relation) {
                    continue;
                }

                if (relation.relation === 'belongsTo') {
                    const relatedPermissions = permissionsConfig[relation.model.toLowerCase()]?.[userRole]?.[action];
                    belongsToQueue.push({
                        field,
                        relation,
                        relatedPermissions,
                    });
                    continue;
                }

                if (permissionsConfig[relation.model.toLowerCase()]) {
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
                    args.select[field].where = this.applyWhereConditions(relation.model, userRole, args.select[field], user, action).where;
                    delete args.select[field].select.where;
                } else {
                    throw new ForbiddenException(`No permissions found for model ${relation.model} and role ${userRole}`);
                }
            }
        }

        if (!permissions) {
            throw new HttpException(`No permissions found for model ${modelName} and role ${userRole}`, HttpStatus.FORBIDDEN);
        }

        const actionPermissions = permissions[action];

        if (!actionPermissions || (actionPermissions === 'ALL' && !belongsToQueue?.length) || action === 'create') {
            return args;
        }

        const whereClause = this.buildConditions(actionPermissions.conditions, user);

        if (!args.where) {
            args.where = whereClause;
        } else {
            args.where = {AND: [args.where, whereClause]};
        }

        //TODO Test this in more scenarios, it may need to be more robust, it's a quick fix but I must make sure it wont be abused by adding a model with this type of relation to bypass something it shouldn't

        if (Object.keys(args.where).length === 0 && !belongsToQueue?.length) {
            throw new ForbiddenException(`You are not authorized to access this record`);
        }

        for (const entry of belongsToQueue) {
            const {relatedPermissions, field} = entry;

            args.where = {
                ...args.where,
                [field]: {
                    AND: [
                        args?.where?.[field] ?? {},
                        this.buildConditions(relatedPermissions?.conditions, user)
                    ]
                }
            };
        }

        return args;
    }

    getRelationType(parentModel: string, relatedField: string) {
        parentModel = parentModel.toLowerCase();
        relatedField = relatedField.toLowerCase();

        const parent = this.fieldConfigs[parentModel];

        const relation = parent.relationFields[relatedField];
        if (!relation) return null;

        return relation;
    }

    /**
     * Builds dynamic conditions based on the type of clause (OR, AND, or field conditions).
     * Each condition is processed, and placeholders (like `$USER_ID`) are replaced with actual values.
     *
     * @param conditions - An array of clauses that define the conditions for the query.
     * @param user - The user object used to replace placeholders.
     * @returns The constructed `where` clause object.
     */
    private buildConditions(conditions: any[], user: any): any {
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
    private replacePlaceholders(condition: any, user: any): any {
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
        return Object.entries(fieldConfig)
            .filter(([_, roles]) => !(roles as string[]).includes(role))
            .map(([field]) => field);
    }

    /**
     * Builds the `select` object for Prisma queries, omitting fields based on the user's role.
     * It handles both scalar fields and relation fields.
     *
     * @param modelName - The name of the model being queried.
     * @param omitFields - A list of fields to omit based on the user's role.
     * @param includeRelations - The relations to include in the query.
     * @param userRole - The role of the user making the request.
     * @returns A `select` object for Prisma queries.
     */
    private buildSelectFields(
        modelName: string,
        omitFields: string[],
        includeRelations: any,
        userRole: string,
    ): any {
        const modelInfo = this.fieldConfigs[modelName.toLowerCase()];
        if (!modelInfo) {
            return {};
        }

        const {scalarFields, relationFields} = modelInfo;
        const selectFields: Record<string, any> = {};

        for (const field of scalarFields) {
            if (!omitFields.includes(field)) {
                selectFields[field] = true;
            }
        }
        if (includeRelations) {
            for (const relationKey in includeRelations) {
                if (!relationFields[relationKey]) continue;
                let includedArgs = includeRelations[relationKey];
                if (includedArgs === true) {
                    includedArgs = {};
                }
                const relatedModelName = this.getRelatedModelName(
                    modelName,
                    relationKey,
                );
                const relatedModelOmitFields = this.getFieldsToOmit(
                    relatedModelName,
                    userRole,
                );
                const relatedSelectFields = this.buildSelectFields(
                    relatedModelName,
                    relatedModelOmitFields,
                    includedArgs.include || null,
                    userRole,
                );

                if (Object.keys(relatedSelectFields).length > 0) {
                    selectFields[relationKey] = {select: relatedSelectFields};
                }
            }
        }

        return selectFields;
    }

    /**
     * Retrieves the related model's name for a given relation field.
     * This is used to navigate relations between models when constructing the `select` object.
     *
     * @param parentModelName - The name of the parent model.
     * @param relationKey - The key of the relation field.
     * @returns The name of the related model.
     * @throws Error if the relation field is not found in the parent model.
     */
    private getRelatedModelName(
        parentModelName: string,
        relationKey: string,
    ): string {
        const modelInfo = this.fieldConfigs[parentModelName.toLowerCase()];
        if (!modelInfo) {
            throw new Error(`Model information not found for ${parentModelName}`);
        }
        if (modelInfo.relationFields[relationKey]) {
            return modelInfo.relationFields[relationKey].model;
        }

        throw new Error(
            `Relation key ${relationKey} not found in model ${parentModelName}`,
        );
    }
}
