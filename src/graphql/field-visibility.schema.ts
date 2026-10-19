import {defaultFieldResolver, GraphQLObjectType, GraphQLSchema, isNonNullType} from 'graphql';
import {PermissionsConfigType} from '../common/config/permissionsConfigTypes';

/**
 * Columns with a `fields` (`visibleOnlyWhen`) rule, for any role, resolve `null`
 * on rows where they aren't visible: each becomes nullable on its model's
 * GraphQL type (a non-null field would turn the `null` into an error), and a
 * value missing from the row resolves `null` instead of the field's
 * `defaultValue` (the column's `@default`, which isn't the row's value).
 */
export function nullableFieldRuleColumns(schema: GraphQLSchema, permissionsConfig: PermissionsConfigType): GraphQLSchema {
    const types = Object.values(schema.getTypeMap());
    for (const [model, roles] of Object.entries(permissionsConfig || {})) {
        const type = types.find((t) => t instanceof GraphQLObjectType && t.name.toLowerCase() === model.toLowerCase()) as GraphQLObjectType | undefined;
        if (!type) continue; // model not exposed over GraphQL
        const fields = type.getFields();
        const columns = new Set(Object.values(roles || {}).flatMap((rules: any) => Object.keys(rules?.fields || {})));
        for (const column of columns) {
            const field = fields[column];
            if (!field) continue;
            if (isNonNullType(field.type)) field.type = field.type.ofType;
            const resolve = field.resolve ?? defaultFieldResolver;
            field.resolve = (root, ...rest) => (root?.[column] === undefined ? null : resolve(root, ...rest));
        }
    }
    return schema;
}
