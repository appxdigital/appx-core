import {ForbiddenException, HttpException, HttpStatus, Inject, Injectable} from '@nestjs/common';
import {Prisma, PrismaClient} from '@prisma/client';
import {PermissionsConfigType} from '../common/config/permissionsConfigTypes';
import {RequestContext} from "nestjs-request-context";
import type {PrismaClient as RuntimeClient} from '.prisma/client';
import {RuntimeDataModel} from "@prisma/client/runtime/edge";

type ModelKey = keyof RuntimeClient;

/** Extra options available on every model method */
export type CorePrismaOptions = {
    BYPASS_OMISSION?: boolean;
    BYPASS_FILTERING?: boolean;
};

// Exclude findUnique, findUniqueOrThrow, delete and update because they are not compatible with permission filtering
export type CorePrismaModel<M extends ModelKey> = Exclude<RuntimeClient[M], 'findUnique' | 'findUniqueOrThrow' | 'delete' | 'update'>;

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

    debugQueries(enable: boolean) {
        RequestContext.currentContext.req.corePrismaDebug = enable;
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

                                    // Blacklisted methods, should not be used to ensure permission filtering is applied
                                    let blacklist: {[key: string]: string} = {
                                        findUnique: 'findFirst',
                                        findUniqueOrThrow: 'findFirstOrThrow',
                                        delete: 'deleteMany',
                                        update: 'updateMany',
                                    };

                                    if (blacklist[methodKey.toString()]) {
                                        throw new Error(`The method ${methodKey.toString()} is not compatible with permission filtering and is not allowed. Please use ${blacklist[methodKey.toString()]}} instead.`);
                                    }

                                    // delete, deleteMany, update and updateMany methods should not apply field omission because they are not selecting fields
                                    if (!options?.BYPASS_OMISSION && !['delete', 'deleteMany', 'update', 'updateMany', 'create', 'createMany'].includes(methodKey.toString())) {
                                        params = this.applyFieldOmission(String(propKey), userRole, params);
                                    } else {
                                        this.debug(`Skipping field omission for ${String(propKey)}.${String(methodKey)}()`);
                                    }
                                    if (!options?.BYPASS_FILTERING && !['create', 'createMany'].includes(methodKey.toString())) {
                                        params = this.applyWhereConditions(String(propKey), userRole, params, user, methodKey);
                                    } else {
                                        this.debug(`Skipping permission filtering for ${String(propKey)}.${String(methodKey)}()`);
                                    }
                                    if (methodKey === 'count' && !!params.select) {
                                        delete params.select;
                                    }
                                    this.debug(`Executing ${String(propKey)}.${String(methodKey)}() with params: ${JSON.stringify(params)}`);
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

        const client = this.prismaClient;

        if (modelName in client) {
            return client[modelName];
        }

        throw new Error(`Model ${model.toString()} not found in PrismaClient.`);
    }

    get model(): RuntimeClient {
        return new Proxy(this.prismaClient, {
            get: (target: RuntimeClient, prop: ModelKey): CorePrismaModel<ModelKey> => {
                if (prop in target) {
                    return target[prop];
                } else {
                    throw new Error(`Model ${String(prop)} does not exist on PrismaClient`);
                }
            },
        });
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
        this.debug(`Applying field omission for model ${modelName} and role ${userRole}`);
        const omitFields = this.getFieldsToOmit(modelName, userRole);
        if (!args) {
            args = {};
        }

        if (args.select) {
            omitFields.forEach((field) => {
                delete args.select[field];
            });
        } else if (args.include) {
            this.debug(`Found included model '${modelName}', generating select fields`);
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

        if (!permissions) {
            throw new HttpException(`No permissions found for model '${modelName}' and role ${userRole}`, HttpStatus.FORBIDDEN);
        }

        let actionPermissions = this.selectPermission(permissions, action.toString(), modelName, userRole);

        if (!actionPermissions) {
            console.debug(`No permissions found for action '${modelName}.${String(action)}()' on role ${userRole}`)
            throw new HttpException('Missing permissions on model ' + modelName, HttpStatus.FORBIDDEN);
        }

        if (args.select) {
            for (const field of Object.keys(args.select)) {
                // If field is relation
                let relation = this.getRelation(modelName, field);
                if (!relation) {
                    continue;
                }

                if (relation.relation === 'belongsTo') {
                    this.debug(`Found 1:1 / *:1 (belongsTo) relation to model '${relation.model}' from model '${modelName}' via field '${field}'. Filter will be applied to main conditions...`);

                    const relatedPermissions = this.selectPermission(permissionsConfig[relation.model.toLowerCase()]?.[userRole] || {}, action.toString(), relation.model, userRole)

                    if (!relatedPermissions) {
                        console.debug(`No permissions found for action '${relation.model}.${String(action)}()' on role ${userRole}`)
                        throw new HttpException('Missing permissions on model ' + relation.model, HttpStatus.FORBIDDEN);
                    }

                    belongsToQueue.push({
                        field,
                        relation,
                        relatedPermissions,
                    });
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
                args.select[field].where = this.applyWhereConditions(relation.model, userRole, args.select[field], user, action).where;
                delete args.select[field].select.where;
            }
        }

        if (actionPermissions === 'ALL' && belongsToQueue.length === 0 || action.toString().startsWith('create')) {
            this.debug(`No conditions to apply for '${modelName}.${String(action)}()' on role ${userRole}`);
            return args;
        }

        const whereClause = this.buildConditions(actionPermissions.conditions, user);

        this.debug(`Applying where conditions for '${modelName}.${String(action)}()' on role ${userRole}: ${JSON.stringify(whereClause)}`);

        if (!args.where) {
            args.where = whereClause;
        } else {
            args.where = {AND: [args.where, whereClause]};
        }

        // Failsafe: If there are no conditions at all and there were supposed to be, block access
        if (Object.keys(args.where).length === 0 && !belongsToQueue?.length) {
            this.debug(`Found a weird edge case. Contact Manuel Olveira @ AppX.`);
            throw new ForbiddenException(`You are not authorized to access this record`);
        }

        if (belongsToQueue?.length > 0) {
            this.debug(`Merging belongsTo relation conditions into main ${modelName}.`, 'warn');
        }

        for (const entry of belongsToQueue) {
            const {relatedPermissions, field} = entry;

            this.debug(`Merging conditions for belongsTo relation field '${field}': ${JSON.stringify(relatedPermissions?.conditions)}`, 'info');

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
                const relatedModelName = this.getRelation(modelName, relationKey, true).model;

                this.debug(`Found relation to model '${relatedModelName}' from model '${modelName}' via field '${relationKey}'. Generating select fields...`);

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

    getRelation(parentModel: string, relatedField: string, throwOnNotFound?: true): {
        model: string,
        relation: string,
        foreignKey?: string,
        referencingColumn?: string,
    }
    getRelation(parentModel: string, relatedField: string, throwOnNotFound = false): {
        model: string,
        relation: string,
        foreignKey?: string,
        referencingColumn?: string,
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

        return actionPermissions;
    }
}
