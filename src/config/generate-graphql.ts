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
/**
 * Hide **to-many (list) relations** from the generated GraphQL model types.
 *
 * Nested selection has no pagination, so selecting a to-many relation
 * (`project { tasks { … } }`) could pull an unbounded number of rows. To-one
 * relations (`project { owner { … } }`) return a single record and stay
 * exposed; `_count` (relation counts, bounded) stays too. Fetch a list at the
 * top level instead — `task { find(where: { projectId … }, take, skip) }` —
 * where pagination + ABAC apply.
 *
 * Implementation: for each model, use the DMMF to find its `kind === 'object'
 * && isList` fields and remove those `@Field(...) name?: Array<…>;` blocks from
 * `<model>.model.ts`, then drop any import left unused. Only the OUTPUT model is
 * touched — `where`/`orderBy` relation filters are unchanged (filtering by a
 * relation returns the parent rows, not the list).
 */
export function hideListRelationsFromModels(allModels: {name: string; fields: any[]}[]): void {
    for (const model of allModels) {
        const listRelations = (model.fields || [])
            .filter((f) => f.kind === 'object' && f.isList)
            .map((f) => f.name as string);
        if (listRelations.length === 0) continue;

        const folder = modelFolder(model.name);
        const modelFile = path.join(generatedRoot, folder, `${folder}.model.ts`);
        if (!fs.existsSync(modelFile)) continue;

        let lines = fs.readFileSync(modelFile, 'utf8').split('\n');
        for (const field of listRelations) {
            const propIdx = lines.findIndex((l) => new RegExp(`^\\s*${field}[?!]?\\s*:`).test(l));
            if (propIdx === -1) continue;
            let start = propIdx;
            while (start - 1 >= 0 && /^\s*@/.test(lines[start - 1])) start--; // preceding decorators
            let end = propIdx;
            if (lines[end + 1] === '') end++; // absorb the trailing blank line
            lines.splice(start, end - start + 1);
        }

        // Drop imports left unused after the removals (each import is a single name).
        let content = lines.join('\n');
        const importRe = /^import\s*\{\s*([A-Za-z0-9_]+)\s*\}\s*from\s*['"][^'"]+['"];?\s*$/;
        content = content
            .split('\n')
            .filter((line) => {
                const m = line.match(importRe);
                if (!m) return true;
                return new RegExp(`\\b${m[1]}\\b`).test(content.replace(line, ''));
            })
            .join('\n');

        fs.writeFileSync(modelFile, content);
    }
}

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
