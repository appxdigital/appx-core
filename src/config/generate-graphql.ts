import * as fs from 'fs';
import * as path from 'path';
import {modelFolder} from './utils';

const generatedRoot = path.join(process.cwd(), 'src/generated');

/**
 * The per-model GraphQL bundle: re-exports the `prisma-nestjs-graphql` types
 * `CoreGraphqlResolver` needs (model + find/get/count inputs), as one import.
 *
 * Emitted for every model into `src/generated/<folder>/graphql.ts` (gitignored,
 * overwrite-safe) so opting a module into GraphQL is a single import + a single
 * provider line — no hand-written resolver file:
 *
 *   import { <Model>Graphql } from '../../generated/<folder>/graphql';
 *   providers: [<Model>Service, CoreGraphqlResolver(<Model>Graphql)]
 */
const bundleTemplate = (model: string, folder: string): string => {
    const camel = model.charAt(0).toLowerCase() + model.slice(1);
    return `import { CoreGraphqlResolver, GraphqlModelBundle } from '@appxdigital/appx-core';
import { ${model} } from './${folder}.model';
import { FindMany${model}Args } from './find-many-${folder}.args';
import { FindFirst${model}Args } from './find-first-${folder}.args';
import { ${model}WhereInput } from './${folder}-where.input';

export const ${model}Graphql: GraphqlModelBundle<${model}> = {
  model: ${model},
  name: '${camel}',
  findManyArgs: FindMany${model}Args,
  findFirstArgs: FindFirst${model}Args,
  whereInput: ${model}WhereInput,
};

/**
 * Ready-to-register read-only GraphQL resolver for ${model} (\`${camel} { find get count }\`).
 * Add it to your ${model} module's \`providers\` to expose the model — no CoreGraphqlResolver
 * import or resolver file needed:
 *
 *   import { ${model}Resolver } from '../../generated/${folder}/graphql';
 *   providers: [${model}Service, ${model}Resolver]
 */
export const ${model}Resolver = CoreGraphqlResolver(${model}Graphql);
`;
};

/**
 * Emit the GraphQL bundle for every model. Part of the deploy-safe pass — it
 * only writes under `src/generated/**`, overwriting each time so the bundle
 * tracks the schema. Requires `prisma generate` (the GraphQL artifacts) to have
 * run first; a model whose generated folder is missing is skipped with a note.
 */
export function generateGraphqlBundles(allModels: {name: string}[]): void {
    for (const {name} of allModels) {
        const folder = modelFolder(name);
        const dir = path.join(generatedRoot, folder);
        if (!fs.existsSync(dir)) {
            console.warn(`Skipping GraphQL bundle for ${name}: ${dir} not found (run prisma generate first).`);
            continue;
        }
        fs.writeFileSync(path.join(dir, 'graphql.ts'), bundleTemplate(name, folder));
    }
}

/**
 * `prisma-nestjs-graphql` emits the full CRUD surface per model
 * (create/update/upsert/delete/aggregate/groupBy inputs), but the read-only
 * GraphQL API only ever imports the model + find/where/orderBy read types. Prune
 * the rest so `src/generated/` stays small and `tsc` doesn't compile dozens of
 * unused files per model.
 *
 * Method: keep the transitive relative-import closure of the generated
 * `graphql.ts` bundles (the read entrypoints), delete every other `.ts` under
 * the model folders + shared `prisma/` folder. The DTO tree (`dto/`, generated
 * by this framework and independent of these types) is preserved untouched.
 */
export function pruneGeneratedGraphql(): void {
    if (!fs.existsSync(generatedRoot)) return;
    const dtoDir = path.resolve(generatedRoot, 'dto');

    // Every prunable .ts under src/generated, excluding the DTO tree.
    const allFiles = new Set<string>();
    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (path.resolve(p) === dtoDir) continue; // preserve DTOs
                walk(p);
            } else if (entry.name.endsWith('.ts')) {
                allFiles.add(path.resolve(p));
            }
        }
    };
    walk(generatedRoot);

    const roots = [...allFiles].filter((f) => path.basename(f) === 'graphql.ts');
    if (roots.length === 0) return; // nothing to anchor the closure — leave as-is

    // BFS the relative-import graph from the bundles.
    const keep = new Set<string>();
    const queue = [...roots];
    const importRe = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;
    while (queue.length) {
        const file = queue.pop() as string;
        if (keep.has(file)) continue;
        keep.add(file);
        let src: string;
        try {
            src = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        importRe.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(src)) !== null) {
            const spec = m[1].endsWith('.ts') ? m[1] : `${m[1]}.ts`;
            const resolved = path.resolve(path.dirname(file), spec);
            if (allFiles.has(resolved) && !keep.has(resolved)) queue.push(resolved);
        }
    }

    let removed = 0;
    for (const f of allFiles) {
        if (!keep.has(f)) {
            fs.rmSync(f);
            removed++;
        }
    }
    // Drop now-empty model dirs (never the DTO tree).
    for (const entry of fs.readdirSync(generatedRoot, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const p = path.join(generatedRoot, entry.name);
        if (path.resolve(p) === dtoDir) continue;
        if (fs.existsSync(p) && fs.readdirSync(p).length === 0) fs.rmdirSync(p);
    }
    console.log(`Pruned ${removed} unused GraphQL type file(s) from src/generated (read-only API).`);
}
