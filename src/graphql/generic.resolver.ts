import {Args, Info, Int, ObjectType, Query, ResolveField, Resolver} from '@nestjs/graphql';
import {BadRequestException} from '@nestjs/common';
import {Type} from '../common/types';
import {PrismaSelect} from '@paljs/plugins';
import {getNamedType, GraphQLObjectType, GraphQLResolveInfo} from 'graphql';
import {PrismaService} from '../prisma/prisma.service';
import {FIELD_REQUIRES_EXTENSION} from '../common/decorators/field-requires.decorator';

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
 * Turn a `PrismaSelect`-derived selection into the columns actually fetched,
 * resolving the source columns that custom `@ResolveField`s need.
 *
 * `PrismaSelect` narrows the Prisma query to exactly the fields the GraphQL
 * request asked for. That breaks the standard NestJS code-first contract where a
 * `@ResolveField` on the model type receives the full entity as `@Parent()`: a
 * custom field (`coverUrl` derived from a `coverKey` column, or a signed-URL
 * transform of an existing field) can't read a source column the client didn't
 * also select. We restore that contract with a **hybrid** strategy that avoids
 * over-fetching:
 *
 *   - A custom field can declare its source columns natively, via the standard
 *     NestJS field `extensions`:
 *         `@ResolveField(() => String, { extensions: { requires: ['coverKey'] } })`
 *     When declared, ONLY those columns are added — no over-fetch.
 *   - A custom field that declares nothing falls back to fetching all of the
 *     model's scalar columns (safe default: the resolver can read anything from
 *     `@Parent()`), at the cost of reading columns the query didn't select.
 *   - A query that selects no custom fields fetches exactly what was asked for.
 *
 * Relations stay selection-driven throughout (no unbounded relation fetching).
 * ABAC field omission runs afterward in the proxy and strips `@Role`-restricted
 * columns at select-time, so a caller still only ever receives — and a transform
 * only ever sees — the columns their role may read.
 *
 * Custom field names (no backing column) are dropped from the Prisma `select`:
 * `PrismaSelect` puts every requested GraphQL field there, and passing a name
 * Prisma doesn't recognise throws a validation error. They resolve from the
 * parent afterward, so they must not reach the query.
 */
function selectReadColumns(
    select: any,
    info: GraphQLResolveInfo,
    prisma: PrismaService,
    modelName: string,
): any {
    const scalars = new Set(prisma.getScalarFields(modelName));
    const requested = select?.select && typeof select.select === 'object' ? select.select : {};

    // The GraphQL type of the returned rows, to read each field's
    // `extensions.requires` (find → [Model], get → Model; getNamedType unwraps).
    const named = getNamedType(info.returnType);
    const gqlFields = named instanceof GraphQLObjectType ? named.getFields() : {};

    const out: Record<string, any> = {};
    const requiredColumns = new Set<string>();
    let needAllScalars = false;

    for (const [key, value] of Object.entries(requested)) {
        if (value && typeof value === 'object') {
            out[key] = value; // a relation (or `_count`) selection — keep as-is
        } else if (scalars.has(key)) {
            out[key] = value; // a real scalar column
        } else {
            // A custom field resolver (no backing column). Prefer its declared
            // dependencies (@FieldRequires); otherwise fall back to all scalars.
            const requires = (gqlFields as any)[key]?.extensions?.[FIELD_REQUIRES_EXTENSION];
            if (Array.isArray(requires)) {
                for (const col of requires) {
                    if (scalars.has(col)) requiredColumns.add(col);
                }
            } else {
                needAllScalars = true;
            }
        }
    }

    if (needAllScalars) {
        for (const field of scalars) out[field] = true;
    } else {
        for (const col of requiredColumns) out[col] = true;
    }

    // Guard against an empty select (e.g. only a custom field with `requires: []`)
    // — an empty Prisma `select` is invalid; fall back to all scalars.
    if (Object.keys(out).length === 0) {
        for (const field of scalars) out[field] = true;
    }

    return {...(select && typeof select === 'object' ? select : {}), select: out};
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
