import * as fs from 'fs';
import * as path from 'path';
import {createFileIfNotExists, kebabToPascalCase} from './utils';

const modelsPath = path.join(process.cwd(), 'src/generated');
const outputPath = path.join(process.cwd(), 'src/modules');

/**
 * Generic resolver template for a given model
 * @param model
 * @param folder
 */
const genericResolverTemplate = (model: string, folder: string) =>
    `import { Resolver } from '@nestjs/graphql';
import { GenericResolverFactory, PrismaService } from 'appx-core';
import { ${model} } from '../../generated/${folder}/${folder}.model';
import { ${model}CreateInput } from '../../generated/${folder}/${folder}-create.input';
import { ${model}UpdateInput } from '../../generated/${folder}/${folder}-update.input';
import { ${model}WhereInput } from '../../generated/${folder}/${folder}-where.input';
import { ${model}WhereUniqueInput } from '../../generated/${folder}/${folder}-where-unique.input';
import { FindMany${model}Args } from '../../generated/${folder}/find-many-${folder}.args';
import { ${model}AggregateArgs } from '../../generated/${folder}/${folder}-aggregate.args';
import { Aggregate${model} } from '../../generated/${folder}/aggregate-${folder}.output';
import { CreateMany${model}Args } from '../../generated/${folder}/create-many-${folder}.args';
import { ${model}CreateManyInput } from '../../generated/${folder}/${folder}-create-many.input';

const ${model}GenericResolver = GenericResolverFactory(
  '${model}',
  ${model},
  ${model}CreateInput,
  ${model}UpdateInput,
  ${model}WhereInput,
  ${model}WhereUniqueInput,
  FindMany${model}Args,
  ${model}AggregateArgs,
  Aggregate${model},
  CreateMany${model}Args,
  ${model}CreateManyInput,
);

@Resolver(() => ${model})
export class ${model}Resolver extends ${model}GenericResolver {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
}
`;

/**
 * Generate resolvers for each model
 */
fs.readdirSync(modelsPath).forEach((folder) => {
    if (folder === 'prisma' || folder === 'schema.gql' || folder === 'session') return;

    const modelName = kebabToPascalCase(folder);
    const modelOutputPath = path.join(outputPath, folder);

    if (!fs.existsSync(modelOutputPath)) {
        fs.mkdirSync(modelOutputPath, {recursive: true});
        console.log(`Folder for model ${modelName} created.`);
    } else {
        console.log(`Folder for model ${modelName} already exists, skipping creation.`);
    }

    const resolverPath = path.join(modelOutputPath, `${folder}.resolver.ts`);
    createFileIfNotExists(resolverPath, genericResolverTemplate(modelName, folder));
});
