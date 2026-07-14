import * as fs from 'fs';
import * as path from 'path';
import {createFileIfNotExists, IGNORE_FOLDERS, kebabToPascalCase} from './utils';

const modelsPath = path.join(process.cwd(), 'src/generated');
const modulesOutputPath = path.join(process.cwd(), 'src/modules');

/**
 * Generic controller template for a given model
 * @param model
 * @param folder
 */
const genericControllerTemplate = (model: string, folder: string) => `
import { Body, Controller, Param, Post, Put } from '@nestjs/common';
import { ${model}Service } from './${folder}.service';
import { ${model} } from '@prisma/client';
import { CoreController, Permission } from '@appxdigital/appx-core';
import { Create${model}Dto } from './dto/create-${folder}.dto';
import { Update${model}Dto } from './dto/update-${folder}.dto';

@Controller('${model.toLowerCase()}s')
export class ${model}Controller extends CoreController<${model}> {
  constructor(protected readonly service: ${model}Service) {
    super(service);
  }

  static get entityName(): string {
    return '${model}';
  }

  // Overridden so the @Body() type is a concrete DTO — this is what lets
  // ValidationPipe (whitelist) strip unknown fields.
  // Custom validation goes in the DTO subclass, not here.
  @Post()
  @Permission('create')
  async create(@Body() data: Create${model}Dto) {
    return super.create(data as any);
  }

  @Put(':id')
  @Permission('updateMany')
  async update(@Param('id') id: string, @Body() data: Update${model}Dto) {
    return super.update(id, data as any);
  }
}
`;

/**
 * Generate controllers for each model
 */
fs.readdirSync(modelsPath).forEach((folder) => {
    if (IGNORE_FOLDERS.includes(folder)) return;

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
