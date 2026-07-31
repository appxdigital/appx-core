import * as path from 'path';
import {createFileIfNotExists, modelFolder, modelRoutePath} from './utils';

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

@Controller('${modelRoutePath(model)}')
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

/** Scaffold the controller file for a single model (once; never overwritten). */
export function scaffoldController(modelName: string): void {
    const folder = modelFolder(modelName);
    const controllerPath = path.join(modulesOutputPath, folder, `${folder}.controller.ts`);
    createFileIfNotExists(controllerPath, genericControllerTemplate(modelName, folder));
}
