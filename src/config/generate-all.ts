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

console.log('Running Prisma Generate (client + GraphQL artifacts)...');
// Project-local prisma: the CLI is usually global, so PATH has no project .bin.
runProjectBin('prisma', 'generate');

console.log('Generating DTO base classes...');
generateDtoBases(loadAllModels());

console.log('Deploy-safe generation complete — src/generated only, no code changes.');
