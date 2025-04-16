#!/usr/bin/env node

import {execSync} from 'child_process';
import * as path from 'path';

const scriptsDir = path.join(__dirname);

console.log('Running Prisma Generate...');
execSync(`npx prisma generate`, {
    stdio: 'inherit',
});

console.log('Generating Modules...');
execSync(`node ${path.join(scriptsDir, 'generate-modules.js')}`, {
    stdio: 'inherit',
});

console.log('Generating Resolvers...');
execSync(`node ${path.join(scriptsDir, 'generate-resolvers.js')}`, {
    stdio: 'inherit',
});

console.log('Generating Services...');
execSync(`node ${path.join(scriptsDir, 'generate-services.js')}`, {
    stdio: 'inherit',
});

console.log('Generating Controllers...');
execSync(`node ${path.join(scriptsDir, 'generate-controllers.js')}`, {
    stdio: 'inherit',
});

// console.log('Generating Session Schema...');
// execSync(`node ${path.join(scriptsDir, 'generate-session-schema.js')}`, {
//   stdio: 'inherit',
// });

console.log('All generators ran successfully.');
