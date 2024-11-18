import {execSync} from "child_process";
import path from "path";


const currentProjectPath = process.cwd();

try {
    const command = 'npm install adminjs @adminjs/express @adminjs/nestjs @adminjs/prisma @prisma/sdk react express-formidable @adminjs/passwords @adminjs/import-export';

    execSync(command, {
        stdio: 'inherit',
        cwd: currentProjectPath
    });

    console.log('Dependencies installed successfully!');

    const scriptsDir = path.join(__dirname);

    console.log('Generating Admin...');

    execSync(`node ${path.join(scriptsDir, 'generate-admin.js')}`, {
        stdio: 'inherit',
    });

    console.log('Admin generated successfully!');
} catch (error : any) {
    console.error('Error installing dependencies:', error.message);
}
