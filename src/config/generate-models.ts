#!/usr/bin/env node

/**
 * `appx generate models` — the module WIZARD (bucket B + C).
 *
 * The only generator that writes hand-owned files under `src/modules/**` and
 * mutates `src/app.module.ts`. For each selected model it scaffolds the module,
 * service, controller, resolver and DTO subclass (each once, never overwritten),
 * then registers the module in AppModule.
 *
 * Model discovery is DMMF-driven (schema is the source of truth), independent of
 * whatever folders the GraphQL plugin emitted. Only models WITHOUT an existing
 * module are offered; framework-owned models (User/Session/UserRefreshToken) are
 * never listed.
 *
 * Usage:
 *   appx generate models              interactive picker
 *   appx generate models Habit Log    scaffold the named models (Pascal or kebab)
 *   appx generate models --all        scaffold every generatable model (legacy)
 *
 * It first runs the deploy-safe pass (prisma generate + DTO bases), so the
 * scaffolded resolver/controller imports resolve.
 */
import {loadAllModels, loadModels, modelFolder, moduleExists, ownedModels, runProjectBin} from './utils';
import {generateDtoBases, scaffoldDtoSubclass} from './generate-dtos';
import {registerModulesInAppModule, scaffoldModule} from './generate-modules';
import {scaffoldService} from './generate-services';
import {scaffoldController} from './generate-controllers';

// inquirer is ESM-only; this file compiles to CommonJS, where tsc would
// down-level a normal `import('inquirer')` into `require()` (ERR_REQUIRE_ESM at
// runtime). Wrapping in `new Function` keeps a genuine dynamic `import()` that
// Node resolves as ESM. Only used on the interactive path.
const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<any>;

async function main(): Promise<void> {
    // 1) Deploy-safe pass first — refresh client + GraphQL artifacts + DTO bases.
    console.log('Running Prisma Generate (client + GraphQL artifacts)...');
    // Project-local prisma: the CLI is usually global, so PATH has no project .bin.
    runProjectBin('prisma', 'generate');
    generateDtoBases(loadAllModels());

    // 2) Candidates = non-framework models with no module yet. "Has a module"
    //    means either the canonical folder exists OR some existing module already
    //    serves the model via CoreController/CoreService<Model> — the latter
    //    catches hand-written modules under a non-canonical (e.g. pluralised)
    //    folder, so we don't scaffold a duplicate.
    const owned = ownedModels();
    const candidates = loadModels().filter((m) => !moduleExists(m.name) && !owned.has(m.name));

    // 3) Resolve the selection from argv, else prompt.
    const args = process.argv.slice(2);
    const wantAll = args.includes('--all');
    const requested = args.filter((a) => !a.startsWith('-'));

    let selected: string[];
    if (wantAll) {
        selected = candidates.map((m) => m.name);
    } else if (requested.length > 0) {
        // Accept a Pascal model name or a kebab folder; only from candidates.
        const byKey = new Map<string, string>();
        for (const m of candidates) {
            byKey.set(m.name.toLowerCase(), m.name);
            byKey.set(modelFolder(m.name), m.name);
        }
        selected = [];
        for (const r of requested) {
            const hit = byKey.get(r.toLowerCase()) ?? byKey.get(r);
            if (hit) selected.push(hit);
            else
                console.warn(
                    `Skipping "${r}": not a generatable model (unknown, framework-owned, or already has a module).`,
                );
        }
    } else {
        if (candidates.length === 0) {
            console.log('No modules available to generate.');
            return;
        }
        const inquirer = (await dynamicImport('inquirer')).default;
        const answer = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'models',
                message: 'Select models to generate CRUD modules for:',
                choices: candidates.map((m) => ({name: m.name, value: m.name})),
            },
        ]);
        selected = answer.models as string[];
    }

    if (selected.length === 0) {
        console.log('No modules generated.');
        return;
    }

    // 4) Scaffold hand-owned files per model, then register the modules.
    for (const name of selected) {
        scaffoldModule(name);
        scaffoldService(name);
        scaffoldController(name);
        scaffoldDtoSubclass(name);
    }
    registerModulesInAppModule(selected);
    console.log(`Generated modules: ${selected.join(', ')}.`);
}

main().catch((err) => {
    console.error('❌ Module generation failed:', err?.message ?? err);
    process.exit(1);
});
