import * as path from 'path';
import {createFileIfNotExists, modelFolder} from './utils';

const outputPath = path.join(process.cwd(), 'src/modules');

/**
 * Generic resolver template for a given model
 * @param model
 * @param folder
 */
const genericResolverTemplate = (model: string, folder: string) =>
    `import { Resolver } from '@nestjs/graphql';
import { GenericResolverFactory, PrismaService } from '@appxdigital/appx-core';
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
 * Scaffold the (read-only) GraphQL resolver file for a single model (once;
 * never overwritten). Imports the prisma-nestjs-graphql artifacts under
 * `src/generated/<folder>/`, so the deploy-safe pass (`prisma generate`) must
 * have produced them first.
 */
export function scaffoldResolver(modelName: string): void {
    const folder = modelFolder(modelName);
    const resolverPath = path.join(outputPath, folder, `${folder}.resolver.ts`);
    createFileIfNotExists(resolverPath, genericResolverTemplate(modelName, folder));
}
