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
