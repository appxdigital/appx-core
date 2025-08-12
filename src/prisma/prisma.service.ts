import {ForbiddenException, HttpException, HttpStatus, Inject, Injectable} from '@nestjs/common';
import {Prisma, PrismaClient} from '@prisma/client';
import {PermissionsConfigType} from '../common/config/permissionsConfigTypes';
import * as path from "path";
import * as fs from "fs";
import {RequestContext} from "nestjs-request-context";
import type {PrismaClient as RuntimeClient} from '.prisma/client';

type ModelKey = keyof RuntimeClient;

@Injectable()
export class PrismaService {
    private fieldConfigs: Record<string, any> = {};
    prismaClient: PrismaClient;
    private schemaPath: string = '';

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
                                return async (params: any, options: any) => {
                                    // delete, deleteMany, update and updateMany methods should not apply field omission because they are not selecting fields
                                    if (!options?.BYPASS_OMISSION && !['delete', 'deleteMany', 'update', 'updateMany', 'create'].includes(methodKey.toString()))
                                        params = this.applyFieldOmission(String(propKey), userRole, params);
                                    if (!options?.BYPASS_FILTERING) {
                                        params = this.applyWhereConditions(String(propKey), userRole, params, user, methodKey);
                                        // findUnique should be findFirst for where conditions to work properly
                                        if (methodKey === 'findUnique')
                                            methodKey = 'findFirst';
                                        // delete should become deleteMany for where conditions to work properly
                                        if (methodKey === 'delete')
                                            methodKey = 'deleteMany';
                                        // update should become updateMany for where conditions to work properly
                                        if (methodKey === 'update')
                                            methodKey = 'updateMany';
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
    getModelDelegate<M extends ModelKey>(model: M): RuntimeClient[M] {
        const modelName = (model as string).toLowerCase();

        const client = this.prismaClient;

        if (modelName in client) {
            return client[modelName];
        }

        throw new Error(`Model ${model.toString()} not found in PrismaClient.`);
    }

    get model(): RuntimeClient {
        return new Proxy(RequestContext.currentContext?.req.prisma || this.prismaClient, {
            get: (target: RuntimeClient, prop: ModelKey): RuntimeClient[ModelKey] => {
                if (prop in target) {
                    return target[prop];
                } else {
                    throw new Error(`Model ${String(prop)} does not exist on PrismaClient`);
                }
            },
        });
    }

    get user(): RuntimeClient['user'] {
        return this.prismaClient.user;
    }

    get session(): RuntimeClient['session'] {
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
        this.schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
        const schema = fs.readFileSync(this.schemaPath, 'utf-8');

        const enums = this.extractEnumsFromSchema(schema);

        this.fieldConfigs = this.extractModelsFromSchema(schema, enums);
    }

    /**
     * Extracts enums from the Prisma schema.
     * @param schema - The raw schema content as a string.
     * @returns An array of enum names.
     */
    private extractEnumsFromSchema(schema: string): string[] {
        const enumRegex = /enum\s+(\w+)\s+\{/g;
        const enums: string[] = [];
        let match;
        while ((match = enumRegex.exec(schema)) !== null) {
            enums.push(match[1]);
        }
        return enums;
    }

    /**
     * Extracts models and custom annotations from the Prisma schema.
     * @param schema - The raw schema content as a string.
     * @param enums - An array of enum names for determining scalar fields.
     * @returns A parsed object with models and their custom annotations.
     */
    private extractModelsFromSchema(schema: string, enums: string[]): Record<string, any> {
        const models: Record<string, any> = {};
        const modelRegex = /model\s+(\w+)\s+\{([\s\S]+?)\}/g;
        let match;

        while ((match = modelRegex.exec(schema)) !== null) {
            const modelName = match[1];
            const modelBody = match[2];
            const {
                allFields,
                fieldConfig,
                fieldTypes,
                scalarFields,
                relationFields,
            } = this.extractFieldsFromModel(modelBody, enums);

            models[modelName.toLowerCase()] = {
                fieldConfig,
                allFields,
                fieldTypes,
                scalarFields,
                relationFields,
            };
        }

        return models;
    }

    /**
     * Extracts fields from the model and looks for custom annotations like @Role.
     * @param modelBody - The body of the model in the schema.
     * @returns A parsed object with fields and their custom annotations.
     */
    private extractFieldsFromModel(modelBody: string, enums: string[]): Record<string, any> {
        const allFields: string[] = [];
        const fieldConfig: Record<string, string[]> = {};
        const fieldTypes: Record<string, string> = {};
        const scalarFields: string[] = [];
        const relationFields: string[] = [];

        const lines = modelBody.split('\n');
        for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine || trimmedLine.startsWith('//')) {
                continue;
            }
            const [codePart, commentPart] = trimmedLine.split('///');

            const codeTokens = codePart.trim().split(/\s+/);
            if (codeTokens.length < 2) {
                continue;
            }

            const fieldName = codeTokens[0];
            const fieldType = codeTokens[1];
            const attributes = codeTokens.slice(2);

            if (commentPart && commentPart.includes('@Role(')) {
                const roleMatch = commentPart.match(/@Role\((.*?)\)/);
                if (roleMatch) {
                    const roles = roleMatch[1].split(',').map(role => role.trim());
                    fieldConfig[fieldName] = roles;
                }
            }

            allFields.push(fieldName);
            fieldTypes[fieldName] = fieldType;

            let baseType = fieldType.replace('?', '').replace('[]', '');
            if (this.isScalarType(baseType, enums)) {
                scalarFields.push(fieldName);
            } else {
                relationFields.push(fieldName);
            }
        }

        return {
            allFields,
            fieldConfig,
            fieldTypes,
            scalarFields,
            relationFields,
        };
    }


    // Helper method to identify scalar types
    private isScalarType(fieldType: string, enums: string[]): boolean {
        const scalarTypes = ['Int', 'String', 'Boolean', 'DateTime', 'Float', 'BigInt', 'Decimal', 'Json', 'Bytes', 'Unsupported'];
        return scalarTypes.includes(fieldType) || enums.includes(fieldType);
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
            for (const model of Object.keys(args.select)) {
                if (!this.fieldConfigs[model.toLowerCase()]) {
                    continue;
                }

                const relation = this.getRelationType(modelName, model);

                if (relation.relation === 'belongsTo') {
                    const relatedPermissions = permissionsConfig[model.toLowerCase()]?.[userRole]?.[action];
                    belongsToQueue.push({
                        modelName: model,
                        relation,
                        relatedPermissions,
                    });
                    continue;
                }

                if (permissionsConfig[model.toLowerCase()]) {
                    this.applyWhereConditions(model, userRole, args.select[model], user, action);
                } else {
                    throw new ForbiddenException(`No permissions found for model ${model} and role ${userRole}`);
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
            args.where = {};
        }

        args.where = {AND: [args.where, whereClause]};

        //TODO Test this in more scenarios, it may need to be more robust, it's a quick fix but I must make sure it wont be abused by adding a model with this type of relation to bypass something it shouldn't

        if (Object.keys(args.where).length === 0 && !belongsToQueue?.length) {
            throw new ForbiddenException(`You are not authorized to access this record`);
        }

        for (const entry of belongsToQueue) {
            const {modelName: relatedModel, relatedPermissions} = entry;

            args.where = {
                ...args.where,
                [relatedModel]: {
                    AND: [
                        args?.where?.[relatedModel] ?? {},
                        this.buildConditions(relatedPermissions?.conditions, user)
                    ]
                }
            };

            //TODO This may no longer be of use, since we are defaulting to not returning the parent if it includes a model the user has no access to.

            // if (relatedPermissions?.conditions) {
            //     const relatedWhere = this.buildConditions(relatedPermissions.conditions, user);
            //     const foreignKey = relation.identifier;
            //     const foreignKeyValue = args.where?.[foreignKey];
            //     const requiredValue = relatedWhere[foreignKey] || relatedWhere.id;
            //
            //
            //     if (requiredValue !== undefined && foreignKeyValue !== requiredValue) {
            // throw new common_1.ForbiddenException(
            //     `Access denied: You are requesting ${modelName.toUpperCase()} with an associated ${relatedModel.toUpperCase()}, ` +
            //     `but your permissions only allow access to ${relatedModel.toUpperCase()} where ${foreignKey} is ${requiredValue}. ` +
            //     `The requested record has ${foreignKey} = ${foreignKeyValue}.`
            // );
            //     }
            // }
        }

        return args;
    }

    getRelationType(parentModel: string, relatedField: string) {
        //TODO Remove what is now unnecessary since this is no longer used to determine the foreign key and it was very strict due to relying on the assumption that said fk would be [model name]_id

        parentModel = parentModel.toLowerCase();
        relatedField = relatedField.toLowerCase();

        const parentKey = Object.keys(this.fieldConfigs).find(
            key => key.toLowerCase() === parentModel
        );
        if (!parentKey) return {relation: null, identifier: null};

        const parent = this.fieldConfigs[parentKey];

        const relationKey = parent.relationFields.find(
            (key: string) => key.toLowerCase() === relatedField
        );
        if (!relationKey) return {relation: null, identifier: null};

        const fieldType = parent.fieldTypes[relationKey];

        if (fieldType.endsWith('[]')) {
            return {relation: 'hasMany', identifier: null};
        }

        const foreignKeyName = `${relatedField}_id`;
        const foreignKey = parent.scalarFields.find(
            (key: string) => key.toLowerCase() === foreignKeyName
        );

        if (foreignKey) {
            return {relation: 'belongsTo', identifier: foreignKey};
        }

        return {relation: null, identifier: null};
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
                if (!relationFields.includes(relationKey)) continue;
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
        if (modelInfo.relationFields.includes(relationKey)) {
            return modelInfo.fieldTypes[relationKey].toLowerCase();
        }

        throw new Error(
            `Relation key ${relationKey} not found in model ${parentModelName}`,
        );
    }
}
