import {Args, Info, Int, ObjectType, Query, ResolveField, Resolver} from '@nestjs/graphql';
import {BadRequestException} from '@nestjs/common';
import {Type} from '../common/types';
import {PrismaSelect} from '@paljs/plugins';
import {getNamedType, GraphQLObjectType, GraphQLResolveInfo} from 'graphql';
import {PrismaService} from '../prisma/prisma.service';
import {getFieldRequires} from './field-requires.registry';

/**
 * Run a read and translate a Prisma **validation** error into a `400`. A
 * malformed `where`/`orderBy` value (e.g. `createdAt: { gt: 2024 }` — a number
 * where a DateTime is expected) can slip past GraphQL coercion and reach Prisma,
 * which throws `PrismaClientValidationError`. That's bad client input, not a
 * server fault: surface a clean `400` instead of a `500` that leaks the raw
 * Prisma invocation. Genuine server errors are re-thrown unchanged.
 */
async function readOrBadRequest<T>(op: () => Promise<T>): Promise<T> {
    try {
        return await op();
    } catch (e: any) {
        if ((e?.name ?? e?.constructor?.name) === 'PrismaClientValidationError') {
            throw new BadRequestException('Invalid query arguments (check where / orderBy types).');
        }
        throw e;
    }
}

/**
 * Build the Prisma `select` for a read so that every custom `@ResolveField` — at
 * the top level and on nested relations — receives its source columns in
 * `@Parent()`.
 *
 * `PrismaSelect` narrows each query to the columns the GraphQL request selected,
 * which breaks the standard NestJS contract that a `@ResolveField` receives the
 * full entity: a transform or computed field can't read a column the client
 * didn't also select, and on a nested relation not even its own key is
 * guaranteed. Using the `@FieldRequires` registry (populated at bootstrap), each
 * selected field that is a custom resolver contributes its declared source
 * columns; a resolver that declared nothing falls back to the model's scalar
 * columns. Plain columns are fetched as-is, so a query with no custom fields is
 * exactly what was asked for. Relations stay selection-driven — only selected
 * relations are fetched, and each is recursed into so its own resolvers get their
 * columns too. ABAC field omission runs afterward in the proxy and strips
 * `@Role`-restricted columns at select-time, so a caller — and a transform — only
 * ever sees readable columns.
 *
 * Custom field names with no backing column are dropped: `PrismaSelect` puts every
 * requested GraphQL field into the `select`, and passing a name Prisma doesn't
 * recognise throws a validation error. They resolve from the parent afterward.
 */
function selectReadColumns(
    select: any,
    info: GraphQLResolveInfo,
    prisma: PrismaService,
    modelName: string,
): any {
    const named = getNamedType(info.returnType);
    const type = named instanceof GraphQLObjectType ? named : null;
    const requested = select?.select && typeof select.select === 'object' ? select.select : {};
    const resolved = resolveLevelColumns(requested, type, prisma, modelName);
    return {...(select && typeof select === 'object' ? select : {}), select: resolved};
}

/**
 * Per-level worker for {@link selectReadColumns}: resolve the columns fetched for
 * one model, recursing into each selected relation against its own model type.
 */
function resolveLevelColumns(
    requested: Record<string, any>,
    type: GraphQLObjectType | null,
    prisma: PrismaService,
    modelName: string,
): Record<string, any> {
    const scalars = prisma.getScalarFields(modelName);
    const scalarSet = new Set(scalars);
    const fields = type ? type.getFields() : undefined;
    const out: Record<string, any> = {};
    const needed = new Set<string>();
    let fetchAllScalars = false;

    for (const [key, value] of Object.entries(requested)) {
        if (value && typeof value === 'object') {
            // A relation or `_count`. Recurse into a known relation model so its
            // own field resolvers get their source columns (a relation's GraphQL
            // type name is its Prisma model name); keep `_count`/opaque verbatim.
            const relField = fields?.[key];
            if (relField && value.select && typeof value.select === 'object') {
                const relType = getNamedType(relField.type);
                if (relType instanceof GraphQLObjectType && prisma.getScalarFields(relType.name).length) {
                    out[key] = {
                        ...value,
                        select: resolveLevelColumns(value.select, relType, prisma, relType.name),
                    };
                    continue;
                }
            }
            out[key] = value;
            continue;
        }

        if (scalarSet.has(key)) {
            out[key] = value; // a real scalar column — keep even if also overridden by a resolver
        }

        // Is this field a custom @ResolveField on this model (new field OR in-place
        // override)? The registry knows, and knows its declared source columns.
        const entry = getFieldRequires(modelName, key);
        if (entry) {
            if (entry.requires) {
                for (const col of entry.requires) {
                    if (scalarSet.has(col)) needed.add(col);
                }
            } else {
                fetchAllScalars = true; // a resolver that declared nothing — fetch all scalars
            }
        }
        // else: a plain column (already added above) or an unknown non-column
        // field name — dropped; it resolves from @Parent() afterward.
    }

    if (fetchAllScalars) {
        for (const field of scalars) out[field] = true;
    } else {
        for (const col of needed) out[col] = true;
    }

    // An empty select is invalid Prisma; fall back to the model's scalar columns.
    if (Object.keys(out).length === 0) {
        for (const field of scalars) out[field] = true;
    }

    return out;
}

/**
 * The generated `prisma-nestjs-graphql` types a model needs to expose its
 * read API. Produced per model by the deploy-safe generator as
 * `src/generated/<model>/graphql.ts` (see `generate-graphql.ts`).
 */
export interface GraphqlModelBundle<ModelType = any> {
    /** The `@ObjectType()` model class (also used to derive the root field name). */
    model: Type<ModelType>;
    /** Root query field name. Defaults to camelCase(model name), e.g. `project`. */
    name?: string;
    /** `FindMany<Model>Args` — arguments for `find`. */
    findManyArgs: Type<any>;
    /** `FindFirst<Model>Args` — arguments for `get`. */
    findFirstArgs: Type<any>;
    /** `<Model>WhereInput` — the `where` argument for `count`. */
    whereInput: Type<any>;
}

/**
 * Build a **namespaced, read-only** GraphQL resolver for one model.
 *
 * Every model contributes a single root query field (its camelCase name) that
 * returns a per-model namespace type exposing three operations:
 *
 *   query {
 *     project {                         # one root field per model — collision-free
 *       find(where, orderBy, take, …)   # → [Project]   (Prisma findMany)
 *       get(where, …)                   # → Project|null (Prisma findFirst)
 *       count(where)                    # → Int          (Prisma count)
 *     }
 *   }
 *
 * Because the operation names (`find`/`get`/`count`) live on the namespace type
 * rather than the root, they repeat freely across models and aliases work as
 * expected (`recent: find(...)`, plus multiple models in one request).
 *
 * Every operation routes through `PrismaService.getModelDelegate`, so the exact
 * same ABAC applies as for REST: row-level filtering, field omission (`@Role`),
 * and nested-relation filtering. `PrismaSelect` turns the GraphQL selection set
 * (including nested relations/children) into a Prisma `select`, so a single
 * query resolves relations in one authorized round-trip.
 *
 * Returned value is a NestJS provider — add it to a module's `providers` to
 * opt that model into GraphQL:
 *
 *   import { CoreGraphqlResolver } from '@appxdigital/appx-core';
 *   import { ProjectGraphql } from '../../generated/project/graphql';
 *   providers: [ProjectService, CoreGraphqlResolver(ProjectGraphql)]
 */
export function CoreGraphqlResolver<ModelType>(bundle: GraphqlModelBundle<ModelType>): Type<any> {
    const {model, findManyArgs, findFirstArgs, whereInput} = bundle;
    const modelName = model.name; // Pascal, e.g. 'Project'
    const rootName = bundle.name ?? modelName.charAt(0).toLowerCase() + modelName.slice(1);

    @ObjectType(`${modelName}Queries`)
    class ModelQueries {}

    @Resolver(() => ModelQueries)
    class ModelQueriesResolver {
        constructor(public readonly prisma: PrismaService) {}

        // The root field. Returns an empty object; the operations below are
        // resolved lazily as fields of the namespace, so `project { count }`
        // never runs `find`/`get`.
        @Query(() => ModelQueries, {
            name: rootName,
            description: `Read queries for ${modelName} — find / get / count. All results are ABAC-filtered.`,
        })
        namespace(): ModelQueries {
            return {} as ModelQueries;
        }

        @ResolveField(() => [model], {
            name: 'find',
            description:
                `List ${modelName} records the caller may read. Paginate with take / skip / cursor; ` +
                `filter with where; sort with orderBy. You can only filter/sort by fields your role can read.`,
        })
        async find(
            @Args({type: () => findManyArgs, nullable: true}) args: any,
            @Info() info: GraphQLResolveInfo,
        ): Promise<ModelType[]> {
            const select = selectReadColumns(new PrismaSelect(info).value, info, this.prisma, modelName);
            return readOrBadRequest(() =>
                this.prisma.getModelDelegate(modelName as any).findMany({...args, ...select}),
            );
        }

        @ResolveField(() => model, {
            name: 'get',
            nullable: true,
            description: `The first ${modelName} matching the arguments, or null.`,
        })
        async get(
            @Args({type: () => findFirstArgs, nullable: true}) args: any,
            @Info() info: GraphQLResolveInfo,
        ): Promise<ModelType | null> {
            const select = selectReadColumns(new PrismaSelect(info).value, info, this.prisma, modelName);
            return readOrBadRequest(() =>
                this.prisma.getModelDelegate(modelName as any).findFirst({...args, ...select}),
            );
        }

        @ResolveField(() => Int, {
            name: 'count',
            description: `Number of ${modelName} records matching where that the caller may read.`,
        })
        async count(
            @Args('where', {
                type: () => whereInput,
                nullable: true,
                description: 'Filter. You can only filter by fields your role can read.',
            })
            where: any,
        ): Promise<number> {
            return readOrBadRequest(() => this.prisma.getModelDelegate(modelName as any).count({where}));
        }
    }

    return ModelQueriesResolver;
}
