import * as path from 'path';
import {createFileIfNotExists, modelFolder} from './utils';

const servicesOutputPath = path.join(process.cwd(), 'src/modules');

/**
 * Generic service template for a given model
 * @param model
 */
const genericServiceTemplate = (model: string) =>
    `import { Injectable } from '@nestjs/common';
import { CoreService, PrismaService } from '@appxdigital/appx-core';
import { ${model} } from '@prisma/client';

@Injectable()
export class ${model}Service extends CoreService<${model}> {
  constructor(private readonly prisma: PrismaService) {
    super(prisma.model.${model[0].toLowerCase() + model.slice(1)});
  }

  // Override methods or add custom logic as needed
}
`;

/** Scaffold the service file for a single model (once; never overwritten). */
export function scaffoldService(modelName: string): void {
    const folder = modelFolder(modelName);
    const servicePath = path.join(servicesOutputPath, folder, `${folder}.service.ts`);
    createFileIfNotExists(servicePath, genericServiceTemplate(modelName));
}
