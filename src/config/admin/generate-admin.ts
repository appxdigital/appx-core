import fs from 'fs';
import path from 'path';
import {adminJsModuleCode} from "./templates/admin.template";
import {permissionsUtilsContent} from "./templates/utils.template";
import {dashboardTemplate} from "./templates/dashboard.template";
import {componentLoaderTemplate} from "./templates/component-loader.template";

const scriptsDir = path.join(__dirname, "/templates");

function ensureDirSync(dirPath: string) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function getTemplateContent(templateFileName: string): string {
    const templatePath = path.join(scriptsDir, templateFileName);
    return fs.readFileSync(templatePath, 'utf8');
}

function setupAdminJS() {
    const projectPath = process.cwd();

    const backofficePath = path.join(projectPath, 'src/backoffice');
    ensureDirSync(backofficePath);

    const backofficeComponentsPath = path.join(backofficePath, 'components');
    ensureDirSync(backofficeComponentsPath);

    fs.writeFileSync(path.join(backofficePath, 'component-loader.ts'), componentLoaderTemplate);

    fs.writeFileSync(path.join(backofficeComponentsPath, 'dashboard.tsx'), dashboardTemplate);

    fs.writeFileSync(path.join(backofficePath, 'utils.ts'), permissionsUtilsContent);

    fs.writeFileSync(path.join(backofficePath, 'admin.ts'), adminJsModuleCode);

    const tsConfigPath = path.join(projectPath, 'tsconfig.json');
    if (fs.existsSync(tsConfigPath)) {
        const tsConfigData = fs.readFileSync(tsConfigPath, 'utf8');
        const tsConfig = JSON.parse(tsConfigData);

        tsConfig.compilerOptions = tsConfig.compilerOptions || {};
        tsConfig.compilerOptions.jsx = 'react';

        fs.writeFileSync(tsConfigPath, JSON.stringify(tsConfig, null, 2));
        console.log('Updated tsconfig.json with JSX support.');
    } else {
        console.error('tsconfig.json not found. Please ensure your project has TypeScript configured.');
    }

    insertInAppModuleImports();

    console.log('Backoffice setup complete!');
}

function insertInAppModuleImports() {
    const projectRoot = process.cwd();
    const appModulePath = path.join(projectRoot, 'src', 'app.module.ts');

    if (!fs.existsSync(appModulePath)) {
        console.error(`Could not find app.module.ts at ${appModulePath}`);
        return;
    }

    let appModuleContent = fs.readFileSync(appModulePath, 'utf8');

    const importStatement = 'import {createAdminJsModule} from "./backoffice/admin";';
    if (!appModuleContent.includes(importStatement)) {
        appModuleContent = `${importStatement}\n${appModuleContent}`;
    }

    const importsRegex = /imports\s*:\s*\[\s*([\s\S]*?)\s*\]/;

    if (importsRegex.test(appModuleContent)) {
        appModuleContent = appModuleContent.replace(
            importsRegex,
            (match: string, importsContent: string) => {
                const trimmedImportsContent = importsContent.trim();

                if (!trimmedImportsContent.includes('createAdminJsModule')) {
                    return `imports: [${trimmedImportsContent}${trimmedImportsContent.endsWith(',') ? '' : ','} \ncreateAdminJsModule().then((AdminJsModule: any) => AdminJsModule)]`;
                }
                return match;
            }
        );

        fs.writeFileSync(appModulePath, appModuleContent, 'utf8');
        console.log('createAdminJsModule has been added to the imports array.');
    } else {
        console.error('Could not find the imports array in app.module.ts');
    }
}

setupAdminJS();