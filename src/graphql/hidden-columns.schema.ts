import {defaultFieldResolver, GraphQLObjectType, GraphQLSchema, isNonNullType} from 'graphql';
import {PermissionsConfigType} from '../common/config/permissionsConfigTypes';
import {PrismaService} from '../prisma/prisma.service';

/**
 * Columns a role may not read — a `/// @Role(...)` annotation, or a `fields`
 * (`visibleOnlyWhen`) rule for any role — resolve `null` where they're omitted:
 * each becomes nullable on its model's GraphQL type (a non-null field would turn
 * the `null` into an error), and a value missing from the row resolves `null`
 * instead of the field's `defaultValue` (the column's `@default`, which isn't the
 * row's value).
 */
export function nullableHiddenColumns(schema: GraphQLSchema, permissionsConfig: PermissionsConfigType, prisma: PrismaService): GraphQLSchema {
    const rules = Object.entries(permissionsConfig || {});
    for (const type of Object.values(schema.getTypeMap())) {
        if (!(type instanceof GraphQLObjectType)) continue;
        const roles = rules.find(([model]) => model.toLowerCase() === type.name.toLowerCase())?.[1];
        const columns = new Set([
            ...prisma.getRoleRestrictedFields(type.name),
            ...Object.values(roles || {}).flatMap((rule: any) => Object.keys(rule?.fields || {})),
        ]);
        const fields = type.getFields();
        for (const column of columns) {
            const field = fields[column];
            if (!field) continue; // not exposed over GraphQL
            if (isNonNullType(field.type)) field.type = field.type.ofType;
            const resolve = field.resolve ?? defaultFieldResolver;
            field.resolve = (root, ...rest) => (root?.[column] === undefined ? null : resolve(root, ...rest));
        }
    }
    return schema;
}
