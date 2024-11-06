import {BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, InternalServerErrorException, NotFoundException,} from '@nestjs/common';
import {Prisma, PrismaClient} from '@prisma/client';
import {PermissionsConfigType} from '../common/config/permissionsConfigTypes';
import * as path from "path";
import * as fs from "fs";


export const BYPASS_OMISSION = Symbol('BYPASS_OMISSION');

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
    }

    $transaction<T>(fn: (prisma: Prisma.TransactionClient) => Promise<T>) {
        return this.prismaClient.$transaction(fn);
    }

    /**
     * Retrieves the model delegate from the Prisma client.
     * Used in the graphql generic resolver
     * @param model
     */
    getModelDelegate(model: string): any {
        const modelName = model.toLowerCase();

        if (modelName in this.prismaClient) {
            return (this.prismaClient as any)[modelName];
        }
        throw new Error(`Model ${model} not found in PrismaClient.`);
    }

    get model() {
        return new Proxy(this.prismaClient, {
            get: (target, prop) => {
                if (prop in target) {
                    return target[prop as keyof PrismaClient];
                } else {
                    throw new Error(`Model ${String(prop)} does not exist on PrismaClient`);
                }
            },
        });
    }

    get user() {
        return this.prismaClient.user;
    }

    get session() {
        return this.prismaClient.session;
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
            } = this.extractFieldsFromModel(modelBody);

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
    private extractFieldsFromModel(modelBody: string): Record<string, any> {
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
            if (this.isScalarType(baseType)) {
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
    private isScalarType(fieldType: string): boolean {
        const scalarTypes = ['Int', 'String', 'Boolean', 'DateTime', 'Float'];
        return scalarTypes.includes(fieldType);
    }


    /**
     * Creates a Prisma client that applies role-based field omission and where conditions.
     * It uses Proxies to intercept Prisma queries and modify them based on the user's role.
     *
     * @param req - The current request object containing user information.
     * @param transactionClient
     * @returns A proxied Prisma client with role-based access control.
     */

    getPrismaClientWithRole(req: any, transactionClient?: Prisma.TransactionClient): PrismaClient | Prisma.TransactionClient {
        const userRole = req.user?.role || 'GUEST';

        const client = transactionClient || this.prismaClient;

        return new Proxy(client, {
            get: (target, propKey) => {
                const modelDelegate = target[propKey];

                if (typeof modelDelegate === 'object' && modelDelegate !== null && !['$connect', '$disconnect', '$use', '$on'].includes(propKey as string)) {
                    return new Proxy(modelDelegate, {
                        get: (model, methodKey) => {
                            if (typeof model[methodKey] === 'function') {
                                return async (params: any) => {
                                    params = this.applyFieldOmission(String(propKey), userRole, params);
                                    params = this.applyWhereConditions(String(propKey), userRole, params, req.user, methodKey);

                                    return model[methodKey](params);
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
        args: Record<string, any> & { [BYPASS_OMISSION]?: boolean },
    ): any {
        if (args && args[BYPASS_OMISSION]) {
            delete args[BYPASS_OMISSION];
            return args;
        }
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
        const normalizedModelName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
        const permissions = this.permissionsConfig[normalizedModelName]?.[userRole] as any;

        if (!permissions) {
            console.warn(`No permissions found for model ${normalizedModelName} and role ${userRole}`);
            return args;
        }

        const actionPermissions = permissions[action];

        if (!actionPermissions || actionPermissions === 'ALL' || action === 'create') {
            return args;
        }

        const whereClause = this.buildConditions(actionPermissions.clauses, user);

        if (!args.where) {
            args.where = {};
        }

        args.where = {...args.where, ...whereClause};

        if (Object.keys(args.where).length === 0) {
            throw new ForbiddenException(`You are not authorized to access this record`);
        }

        return args;
    }

    /**
     * Builds dynamic conditions based on the type of clause (OR, AND, or field conditions).
     * Each condition is processed, and placeholders (like `$USER_ID`) are replaced with actual values.
     *
     * @param clauses - An array of clauses that define the conditions for the query.
     * @param user - The user object used to replace placeholders.
     * @returns The constructed `where` clause object.
     */
    private buildConditions(clauses: any[], user: any): any {
        const whereClause: Record<string, any> = {};

        if (!clauses) {
            return whereClause;
        }
        clauses.forEach((clause) => {
            if (clause.type === 'OR') {
                whereClause['OR'] = clause.conditions.map((condition: any) =>
                    this.replacePlaceholders(condition, user),
                );
            } else if (clause.type === 'field') {
                const field = Object.keys(clause.conditions)[0];
                whereClause[field] = this.replacePlaceholders(
                    clause.conditions[field],
                    user,
                );
            }
        });

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

    /**
     * Handles errors thrown by Prisma queries and converts them into appropriate exceptions.
     * This function interprets various Prisma error codes and throws NestJS exceptions.
     *
     * @param error - The error thrown by Prisma.
     * @throws ConflictException, NotFoundException, BadRequestException, or InternalServerErrorException.
     */
    handleError(error: any): never {
        if (error && typeof error === 'object' && 'code' in error) {
            switch (error.code) {
                case 'P2002':
                    throw new ConflictException('Duplicate entry detected.');
                case 'P2025':
                    throw new NotFoundException('The requested record was not found.');
                default:
                    throw new BadRequestException('A Prisma database error occurred.');
            }
        } else {
            throw error;
        }
    }
}
