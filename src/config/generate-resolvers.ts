import * as fs from 'fs';
import * as path from 'path';
import { capitalizeFirstLetter, createFileIfNotExists } from './utils';

const modelsPath = path.join(process.cwd(), 'src/generated');
const outputPath = path.join(process.cwd(), 'src/modules');

/**
 * Generic resolver template for a given model
 * @param model
 */
const genericResolverTemplate = (model: string) =>
  `import { Resolver } from '@nestjs/graphql';
import { GenericResolverFactory, PrismaService } from 'appx_core';
import { ${model} } from '../../generated/${model.toLowerCase()}/${model.toLowerCase()}.model';
import { ${model}CreateInput } from '../../generated/${model.toLowerCase()}/${model.toLowerCase()}-create.input';
import { ${model}UpdateInput } from '../../generated/${model.toLowerCase()}/${model.toLowerCase()}-update.input';
import { ${model}WhereInput } from '../../generated/${model.toLowerCase()}/${model.toLowerCase()}-where.input';
import { ${model}WhereUniqueInput } from '../../generated/${model.toLowerCase()}/${model.toLowerCase()}-where-unique.input';
import { FindMany${model}Args } from '../../generated/${model.toLowerCase()}/find-many-${model.toLowerCase()}.args';
import { ${model}AggregateArgs } from '../../generated/${model.toLowerCase()}/${model.toLowerCase()}-aggregate.args';
import { Aggregate${model} } from '../../generated/${model.toLowerCase()}/aggregate-${model.toLowerCase()}.output';
import { CreateMany${model}Args } from '../../generated/${model.toLowerCase()}/create-many-${model.toLowerCase()}.args';
import { ${model}CreateManyInput } from '../../generated/${model.toLowerCase()}/${model.toLowerCase()}-create-many.input';

const ${model}GenericResolver = GenericResolverFactory(
  '${model.toLowerCase()}',
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

  const modelName = capitalizeFirstLetter(folder);
  const modelOutputPath = path.join(outputPath, folder);

  if (!fs.existsSync(modelOutputPath)) {
    fs.mkdirSync(modelOutputPath, { recursive: true });
    console.log(`Folder for model ${modelName} created.`);
  } else {
    console.log(`Folder for model ${modelName} already exists, skipping creation.`);
  }

  const resolverPath = path.join(modelOutputPath, `${folder}.resolver.ts`);
  createFileIfNotExists(resolverPath, genericResolverTemplate(modelName));
});
