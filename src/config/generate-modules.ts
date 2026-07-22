import * as fs from 'fs';
import * as path from 'path';
import {createFileIfNotExists, modelFolder} from './utils';

const modulesOutputPath = path.join(process.cwd(), 'src/modules');
const appModulePath = path.join(process.cwd(), 'src/app.module.ts');

/**
 * Generic module template for a given model
 * @param model
 * @param folder
 */
const moduleTemplate = (model: string, folder: string) => `
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ${model}Controller } from './${folder}.controller';
import { ${model}Service } from './${folder}.service';
import { ${model}Resolver } from './${folder}.resolver';

@Module({
  imports: [PrismaModule],
  controllers: [${model}Controller],
  providers: [${model}Service, ${model}Resolver],
})
export class ${model}Module {}
`;

/** Scaffold the module file for a single model (once; never overwritten). */
export function scaffoldModule(modelName: string): void {
    const folder = modelFolder(modelName);
    const modulePath = path.join(modulesOutputPath, folder, `${folder}.module.ts`);
    createFileIfNotExists(modulePath, moduleTemplate(modelName, folder));
}

/**
 * Register the given models' modules in `src/app.module.ts` — the ONE code
 * mutation in the generator, performed only by the module wizard (never by the
 * deploy-safe pass). Idempotent: a module already imported / already in the
 * `imports:` array is left untouched. Scoped to the models passed in — it does
 * NOT scan `src/modules`, so it never registers something the caller didn't ask
 * for.
 */
export function registerModulesInAppModule(modelNames: string[]): void {
    if (modelNames.length === 0) return;

    let appModuleContent = fs.readFileSync(appModulePath, 'utf8');

    // Existing module imports (by `import { XModule } from './modules/…'`).
    const importRegex = /import { (\w+)Module } from '.\/modules\/[\w-]+\/[\w-]+.module';/g;
    const existingImports = new Set<string>();
    let match;
    while ((match = importRegex.exec(appModuleContent)) !== null) {
        existingImports.add(`${match[1]}Module`);
    }

    // Existing entries already inside the `imports: [ … ]` array.
    const importsArrayRegex = /(imports:\s*\[)([^]*?)(\])/;
    const importsArrayMatch = appModuleContent.match(importsArrayRegex);
    const existingModuleNames = new Set<string>();
    if (importsArrayMatch) {
        importsArrayMatch[2]
            .split(',')
            .map((m) => m.trim().replace(/\s/g, ''))
            .filter((m) => m)
            .forEach((moduleName) => existingModuleNames.add(moduleName));
    }

    const newImports: string[] = [];
    const newModules: string[] = [];
    for (const modelName of modelNames) {
        const moduleName = `${modelName}Module`;
        const folder = modelFolder(modelName);
        if (existingImports.has(moduleName) || existingModuleNames.has(moduleName)) continue;
        newImports.push(`import { ${moduleName} } from './modules/${folder}/${folder}.module';`);
        newModules.push(moduleName);
    }

    if (newImports.length === 0) {
        console.log('No new modules to register in AppModule.');
        return;
    }

    // Add the new modules to the `imports:` array without duplicates.
    appModuleContent = appModuleContent.replace(
        importsArrayRegex,
        (_, prefix, currentImports, suffix) => {
            const currentModules = currentImports
                .split(',')
                .map((m: string) => m.trim())
                .filter((m: string) => m);
            newModules.forEach((newModule) => {
                if (!currentModules.includes(newModule)) currentModules.push(newModule);
            });
            return `${prefix}${currentModules.join(', ')}${suffix}`;
        },
    );

    const finalContent = newImports.join('\n') + '\n' + appModuleContent;
    fs.writeFileSync(appModulePath, finalContent);
    console.log(`AppModule updated: registered ${newModules.join(', ')}.`);
}
