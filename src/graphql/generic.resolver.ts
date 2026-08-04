import {Args, Info, Int, ObjectType, Query, ResolveField, Resolver} from '@nestjs/graphql';
import {BadRequestException} from '@nestjs/common';
import {Type} from '../common/types';
import {PrismaSelect} from '@paljs/plugins';
import {GraphQLResolveInfo} from 'graphql';
import {PrismaService} from '../prisma/prisma.service';

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
            const select = new PrismaSelect(info).value;
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
            const select = new PrismaSelect(info).value;
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
