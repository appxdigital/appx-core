import * as fs from 'fs';
import * as path from 'path';
import {createFileIfNotExists, kebabToPascalCase} from './utils';

const modelsPath = path.join(process.cwd(), 'src/generated');
const modulesOutputPath = path.join(process.cwd(), 'src/modules');

/**
 * Generic controller template for a given model
 * @param model
 * @param folder
 */
const genericControllerTemplate = (model: string, folder: string) => `
import { Controller } from '@nestjs/common';
import { ${model}Service } from './${folder}.service';
import { ${model} } from '@prisma/client';
import { CoreController } from 'appx_core';

@Controller('${model.toLowerCase()}s')
export class ${model}Controller extends CoreController<${model}> {
  constructor(protected readonly service: ${model}Service) {
    super(service);
  }

  static get entityName(): string {
    return '${model}';
  }
}
`;

/**
 * Generate controllers for each model
 */
fs.readdirSync(modelsPath).forEach((folder) => {
    if (folder === 'prisma' || folder === 'schema.gql' || folder === 'session') return;

    const modelName = kebabToPascalCase(folder);  // Capitalize model name e.g., 'Comment', 'Post'
    const modelOutputPath = path.join(modulesOutputPath, folder);

    if (!fs.existsSync(modelOutputPath)) {
        fs.mkdirSync(modelOutputPath, {recursive: true});
        console.log(`Folder for model ${modelName} created.`);
    } else {
        console.log(`Folder for model ${modelName} already exists, skipping creation.`);
    }
    /**
     * Create the controller file
     */
    const controllerPath = path.join(modelOutputPath, `${folder}.controller.ts`);
    createFileIfNotExists(controllerPath, genericControllerTemplate(modelName, folder));
});
