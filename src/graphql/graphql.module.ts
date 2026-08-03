import {Module} from '@nestjs/common';
import {GraphQLModule, Query, Resolver} from '@nestjs/graphql';
import {ApolloDriver, ApolloDriverConfig} from '@nestjs/apollo';
import {Request, Response} from 'express';

/**
 * Always-present root query. GraphQL requires a non-empty `Query` type, but a
 * project may register `GraphqlModule` before any model has opted in (models
 * opt in per-module via `CoreGraphqlResolver`). This trivial field keeps the
 * schema valid in that state so `/graphql` is live from the start.
 */
@Resolver()
export class AppxCoreRootResolver {
    @Query(() => String, {
        name: '_appxCore',
        description: 'Liveness field. Ensures a valid GraphQL schema even before any model opts in.',
    })
    appxCore(): string {
        return '@appxdigital/appx-core';
    }
}

@Module({
    imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
            driver: ApolloDriver,
            context: ({req, res}: {req: Request; res: Response}) => ({req, res}),
            // Build the schema in memory (code-first). Nothing consumes the SDL
            // file, and an in-memory schema avoids depending on a writable
            // `src/generated/` path at boot (CI, read-only deploys, tests).
            autoSchemaFile: true,
            sortSchema: true,
        }),
    ],
    providers: [AppxCoreRootResolver],
})
export class GraphqlModule {}
