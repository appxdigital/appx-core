import {Module} from '@nestjs/common';
import {DiscoveryModule} from '@nestjs/core';
import {GraphQLModule, Query, Resolver} from '@nestjs/graphql';
import {ApolloDriver, ApolloDriverConfig} from '@nestjs/apollo';
import {Request, Response} from 'express';
import {FieldRequiresScanner} from './field-requires.registry';
import {nullableHiddenColumns} from './hidden-columns.schema';
import {PERMISSIONS_CONFIG_TOKEN} from '../common/config/permissions.config.provider';
import {PermissionsConfigType} from '../common/config/permissionsConfigTypes';
import {PrismaService} from '../prisma/prisma.service';

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
        // DiscoveryService/MetadataScanner power the @FieldRequires bootstrap scan.
        DiscoveryModule,
        GraphQLModule.forRootAsync<ApolloDriverConfig>({
            driver: ApolloDriver,
            inject: [PERMISSIONS_CONFIG_TOKEN, PrismaService],
            useFactory: (permissionsConfig: PermissionsConfigType, prisma: PrismaService) => ({
                context: ({req, res}: {req: Request; res: Response}) => ({req, res}),
                // Build the schema in memory (code-first). Nothing consumes the SDL
                // file, and an in-memory schema avoids depending on a writable
                // `src/generated/` path at boot (CI, read-only deploys, tests).
                autoSchemaFile: true,
                sortSchema: true,
                // Introspection powers the Apollo Sandbox (GET /graphql). It exposes
                // the schema shape (not data — ABAC still governs every field), so we
                // keep it ON in development for the Sandbox, and OFF in production as
                // defense-in-depth (less recon surface). Opt back in for a production
                // deployment with APPX_GRAPHQL_INTROSPECTION=true. Without this, Apollo
                // Server disables introspection under NODE_ENV=production and the
                // Sandbox fails with `INTROSPECTION_DISABLED`.
                introspection:
                    process.env.NODE_ENV !== 'production' ||
                    process.env.APPX_GRAPHQL_INTROSPECTION === 'true',
                // Columns hidden by `@Role` or a `fields` rule resolve null where omitted.
                transformSchema: (schema) => nullableHiddenColumns(schema, permissionsConfig, prisma),
            }),
        }),
    ],
    providers: [AppxCoreRootResolver, FieldRequiresScanner],
})
export class GraphqlModule {}
