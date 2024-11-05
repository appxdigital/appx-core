import * as fs from 'fs';
import * as path from 'path';
import { capitalizeFirstLetter, createFileIfNotExists } from './utils';

const modelsPath = path.join(process.cwd(), 'src/generated');
const servicesOutputPath = path.join(process.cwd(), 'src/modules');

/**
 * Generic service template for a given model
 * @param model
 */
const genericServiceTemplate = (model: string) =>
    `import { Injectable } from '@nestjs/common';
import { CoreService, PrismaService } from 'appx_core';
import { ${model} } from '@prisma/client';

@Injectable()
export class ${model}Service extends CoreService<${model}> {
  constructor(prisma: PrismaService) {
    super(prisma, prisma.model.${model[0].toLowerCase() + model.slice(1)});
  }

  // Override methods or add custom logic as needed
}
`;

/**
 * Generate services for each model
 */
fs.readdirSync(modelsPath).forEach((folder) => {
  if (folder === 'prisma' || folder === 'schema.gql' || folder === 'session') return;

  const modelName = capitalizeFirstLetter(folder);
  const modelOutputPath = path.join(servicesOutputPath, folder);
  if (!fs.existsSync(modelOutputPath)) {
    fs.mkdirSync(modelOutputPath, { recursive: true });
    console.log(`Folder for model ${modelName} created.`);
  }

  const servicePath = path.join(modelOutputPath, `${folder}.service.ts`);
  createFileIfNotExists(servicePath, genericServiceTemplate(modelName));
});
