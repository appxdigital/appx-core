import * as fs from 'fs';
import * as path from 'path';
import { capitalizeFirstLetter } from './utils';

const modelsPath = path.join(process.cwd(), 'src/generated');
const modulesOutputPath = path.join(process.cwd(), 'src/modules');
const appModulePath = path.join(process.cwd(), 'src/app.module.ts');

/**
 * Generic module template for a given model
 * @param model
 */
const moduleTemplate = (model: string) => `
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ${model}Controller } from './${model.toLowerCase()}.controller';
import { ${model}Service } from './${model.toLowerCase()}.service';
import { ${model}Resolver } from './${model.toLowerCase()}.resolver';

@Module({
  imports: [PrismaModule],
  controllers: [${model}Controller],
  providers: [${model}Service, ${model}Resolver],
})
export class ${model}Module {}
`;

/**
 * Create or update the module file for a given model
 * @param model
 * @param modulePath
 */
const createModuleFile = (model: string, modulePath: string) => {
    const moduleContent = moduleTemplate(model);
    fs.writeFileSync(modulePath, moduleContent);
    console.log(`Module for ${model} created or updated.`);
};

/**
 * Update the AppModule with new module imports
 */
const updateAppModule = () => {
    let appModuleContent = fs.readFileSync(appModulePath, 'utf8');

    /**
     * Regex to extract existing module imports from the AppModule
     */
    const importRegex = /import { (\w+)Module } from '.\/modules\/\w+\/\w+.module';/g;
    const existingImports = new Set<string>();
    let match;
    while ((match = importRegex.exec(appModuleContent)) !== null) {
        existingImports.add(match[1]);
    }

    const newImports: string[] = [];
    const newModules: string[] = [];

    /**
     * Regex to extract the imports array from the AppModule to prevent duplicates
     */
    const importsArrayRegex = /(imports:\s*\[)([^]*?)(\])/;
    const importsArrayMatch = appModuleContent.match(importsArrayRegex);
    const existingModuleNames = new Set<string>();

    if (importsArrayMatch) {
        const currentImportsArray = importsArrayMatch[2]
            .split(',')
            .map((m) => m.trim().replace(/\s/g, ''))
            .filter((m) => m);
        currentImportsArray.forEach((moduleName) => {
            existingModuleNames.add(moduleName);
        });
    }

    /**
     * Iterate over the modules directory and add new imports to the AppModule
     */
    fs.readdirSync(modulesOutputPath).forEach((folder) => {
        if (folder === 'prisma' || folder === 'schema.gql' || folder === 'session') return;

        const modelName = capitalizeFirstLetter(folder);
        const moduleName = `${modelName}Module`;

        // Ensure no duplicate imports and no duplicate entries in the imports array
        if (!existingImports.has(moduleName) && !existingModuleNames.has(moduleName)) {
            newImports.push(`import { ${modelName}Module } from './modules/${folder}/${folder}.module';`);
            newModules.push(moduleName);
        }
    });

    if (newImports.length === 0) {
        console.log('No new modules to add.');
        return;
    }

    // Add new imports to AppModule and update the imports array without duplicates
    appModuleContent = appModuleContent.replace(
        /(imports:\s*\[)([^]*?)(\])/,
        (_, prefix, currentImports, suffix) => {
            const currentModules = currentImports
                .split(',')
                .map((m:string) => m.trim())
                .filter((m:string) => m);
            newModules.forEach((newModule) => {
                if (!currentModules.includes(newModule)) {
                    currentModules.push(newModule);
                }
            });
            return `${prefix}${currentModules.join(', ')}${suffix}`;
        }
    );

    const finalContent = newImports.join('\n') + '\n' + appModuleContent;
    fs.writeFileSync(appModulePath, finalContent);
    console.log('AppModule updated successfully.');
};

/**
 * Generate modules for each model
 */
fs.readdirSync(modelsPath).forEach((folder) => {
    if (folder === 'prisma' || folder === 'schema.gql' || folder === 'session') return;

    const modelName = capitalizeFirstLetter(folder);
    const modelOutputPath = path.join(modulesOutputPath, folder);

    if (!fs.existsSync(modelOutputPath)) {
        fs.mkdirSync(modelOutputPath, { recursive: true });
        console.log(`Folder for model ${modelName} created.`);
    }

    const modulePath = path.join(modelOutputPath, `${folder}.module.ts`);

    if (!fs.existsSync(modulePath)) {
        createModuleFile(modelName, modulePath);
    } else {
        console.log(`Module for ${modelName} already exists, skipping.`);
    }
});

updateAppModule();
