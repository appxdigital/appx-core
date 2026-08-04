#!/usr/bin/env node

/**
 * `appx generate` — the DEPLOY-SAFE pass.
 *
 * Regenerates only the overwrite-safe artifacts under the gitignored
 * `src/generated/**`:
 *   - the Prisma client and the prisma-nestjs-graphql outputs (`prisma generate`
 *     runs both generator blocks), and
 *   - the DTO base classes (`src/generated/dto/**`).
 *
 * It NEVER writes `src/modules/**` and NEVER edits `src/app.module.ts`, so it is
 * safe to run in CI / postinstall / predeploy and re-run any number of times.
 * Scaffolding CRUD modules (which mutates code) is the separate, interactive
 * `appx generate models` wizard.
 */
import {loadAllModels, runProjectBin} from './utils';
import {generateDtoBases} from './generate-dtos';
import {generateGraphqlBundles, hideListRelationsFromModels, pruneGeneratedGraphql} from './generate-graphql';

/**
 * The deploy-safe pass, as a single reusable unit. `generate models` (the
 * wizard) runs it too before scaffolding, so keeping it here — rather than
 * duplicating the steps — stops the two paths from drifting (e.g. one pruning
 * the GraphQL types and the other regenerating them unpruned).
 */
export function runDeploySafePass(): void {
    console.log('Running Prisma Generate (client + GraphQL artifacts)...');
    // Project-local prisma: the CLI is usually global, so PATH has no project .bin.
    runProjectBin('prisma', 'generate');

    const allModels = loadAllModels();

    console.log('Generating DTO base classes...');
    generateDtoBases(allModels);

    console.log('Generating GraphQL bundles...');
    generateGraphqlBundles(allModels);

    console.log('Hiding to-many relations from GraphQL models (nested lists have no pagination)...');
    hideListRelationsFromModels(allModels);

    console.log('Pruning unused GraphQL types (read-only API)...');
    pruneGeneratedGraphql();

    console.log('Deploy-safe generation complete — src/generated only, no code changes.');
}

// Only run when invoked directly (`node generate-all.js`), not when imported by
// the wizard (which calls runDeploySafePass() itself).
if (require.main === module) {
    runDeploySafePass();
}
