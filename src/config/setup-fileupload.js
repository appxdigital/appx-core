#!/usr/bin/env node
// Frozen compiled output — kept so existing projects keep working; do not edit.
// Readable source to copy into a project: docs/legacy/file-upload (see docs/storage.md).
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const inquirer_1 = __importDefault(require("inquirer"));
const FileTypes = {
    IMAGE: 'image',
    DOCUMENT: 'document',
    VIDEO: 'video',
    AUDIO: 'audio',
};
const MimeTypes = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    document: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    video: ['video/mp4', 'video/avi', 'video/mpeg'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
};
function objectToTypeScript(obj, indentLevel = 0) {
    const indent = '    '.repeat(indentLevel);
    if (Array.isArray(obj)) {
        const items = obj
            .map((item) => objectToTypeScript(item, indentLevel + 1))
            .join(`,\n`);
        return `[\n${items}\n${indent}]`;
    }
    else if (typeof obj === 'object' && obj !== null) {
        const props = Object.entries(obj)
            .map(([key, value]) => `${indent}    ${key}: ${objectToTypeScript(value, indentLevel + 1)}`)
            .join(`,\n`);
        return `{\n${props}\n${indent}}`;
    }
    else if (typeof obj === 'string') {
        return `'${obj}'`;
    }
    else {
        return String(obj);
    }
}
function getEnvVariables(provider, providerConfig) {
    if (provider === 'aws') {
        return {
            AWS_BUCKET_NAME: providerConfig.bucket,
            AWS_REGION: providerConfig.region,
            AWS_ACCESS_KEY_ID: providerConfig.accessKeyId,
            AWS_SECRET_ACCESS_KEY: providerConfig.secretAccessKey,
        };
    }
    else if (provider === 'gcp') {
        return {
            GCP_BUCKET_NAME: providerConfig.bucket,
            GCP_PROJECT_ID: providerConfig.projectId,
            GCP_KEY_FILE_PATH: providerConfig.keyFilePath,
        };
    }
    else {
        return {};
    }
}
async function configureProvider() {
    const { provider } = await inquirer_1.default.prompt({
        type: 'list',
        name: 'provider',
        message: 'Select the storage provider:',
        choices: ['aws', 'gcp', 'local'],
    });
    let providerConfig = {};
    if (provider === 'aws') {
        providerConfig = await inquirer_1.default.prompt([
            { type: 'input', name: 'bucket', message: 'Enter AWS S3 bucket name:' },
            { type: 'input', name: 'region', message: 'Enter AWS region:' },
            { type: 'input', name: 'accessKeyId', message: 'Enter AWS access key ID:' },
            { type: 'input', name: 'secretAccessKey', message: 'Enter AWS secret access key:' },
        ]);
    }
    else if (provider === 'gcp') {
        providerConfig = await inquirer_1.default.prompt([
            { type: 'input', name: 'bucket', message: 'Enter GCP bucket name:' },
            { type: 'input', name: 'projectId', message: 'Enter GCP project ID:' },
            { type: 'input', name: 'keyFilePath', message: 'Enter the path to the GCP service account key file:' },
        ]);
    }
    const envVariables = getEnvVariables(provider, providerConfig);
    const envContent = Object.entries(envVariables)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    fs.appendFileSync(path.resolve(process.cwd(), '.env'), `\n${envContent}\n`);
    return { provider };
}
async function configureEndpoint() {
    const { endpoint, maxSize, fileType, multiple } = await inquirer_1.default.prompt([
        {
            type: 'input',
            name: 'endpoint',
            message: 'Enter the endpoint (e.g., "avatar" for /upload/avatar):',
        },
        {
            type: 'input',
            name: 'maxSize',
            message: 'Enter the maximum file size (in MB):',
            validate: (input) => !isNaN(Number(input)) && Number(input) > 0 ? true : 'Please enter a valid positive number',
            filter: (input) => Number(input) * 1024 * 1024,
        },
        {
            type: 'list',
            name: 'fileType',
            message: 'Select file category:',
            choices: Object.values(FileTypes),
        },
        {
            type: 'confirm',
            name: 'multiple',
            message: 'Allow multiple file uploads?',
        },
    ]);
    let allowedTypes = [];
    if (fileType in MimeTypes) {
        const result = await inquirer_1.default.prompt({
            type: 'checkbox',
            name: 'selectedMimeTypes',
            message: `Select allowed MIME types for ${fileType}:`,
            choices: [...MimeTypes[fileType]],
            validate: (answer) => {
                if (!Array.isArray(answer) || answer.length === 0) {
                    return 'You must select at least one MIME type.';
                }
                return true;
            },
        });
        allowedTypes = result.selectedMimeTypes;
    }
    const { roles } = await inquirer_1.default.prompt({
        type: 'input',
        name: 'roles',
        message: 'Enter allowed roles (comma-separated, or "ALL" for unrestricted access):',
        filter: (input) => input.split(',').map((role) => role.trim()),
    });
    return {
        endpoint: `/upload/${endpoint}`,
        aliases: [],
        maxSize,
        allowedTypes,
        multiple,
        roles,
    };
}
function findMatchingBracketIndex(content, startIndex) {
    let stack = [];
    for (let i = startIndex; i < content.length; i++) {
        const char = content[i];
        if (char === '[') {
            stack.push('[');
        }
        else if (char === ']') {
            stack.pop();
            if (stack.length === 0) {
                return i;
            }
        }
    }
    return -1;
}
function appendEndpointToFile(configPath, newEndpointConfig) {
    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const endpointsIndex = fileContent.indexOf('endpoints: [');
    if (endpointsIndex === -1) {
        console.error("Couldn't locate 'endpoints' array in file-upload.config.ts.");
        process.exit(1);
    }
    const arrayStartIndex = fileContent.indexOf('[', endpointsIndex);
    const arrayEndIndex = findMatchingBracketIndex(fileContent, arrayStartIndex);
    if (arrayEndIndex === -1) {
        console.error("Couldn't locate the end of 'endpoints' array in file-upload.config.ts.");
        process.exit(1);
    }
    let existingEndpointsContent = fileContent.substring(arrayStartIndex + 1, arrayEndIndex).trim();
    const newEndpointString = objectToTypeScript(newEndpointConfig, 2);
    let updatedEndpointsContent;
    if (existingEndpointsContent.length === 0) {
        updatedEndpointsContent = `\n${newEndpointString}\n`;
    }
    else {
        existingEndpointsContent = existingEndpointsContent.replace(/,\s*$/, '');
        updatedEndpointsContent = `${existingEndpointsContent},\n${newEndpointString}`;
    }
    const updatedFileContent = `${fileContent.substring(0, arrayStartIndex + 1)}\n${updatedEndpointsContent}\n${fileContent.substring(arrayEndIndex)}`;
    fs.writeFileSync(configPath, updatedFileContent);
    console.log(`New endpoint added to ${configPath} successfully.`);
}
async function main() {
    const configPath = path.resolve(process.cwd(), 'src/config/file-upload.config.ts');
    const appModulePath = path.resolve(process.cwd(), 'src/app.module.ts');
    const isEndpointMode = process.argv.includes('endpoint');
    if (isEndpointMode) {
        if (!fs.existsSync(configPath)) {
            console.error(`Configuration file at ${configPath} not found. Please run the full setup first.`);
            process.exit(1);
        }
        const newEndpointConfig = await configureEndpoint();
        appendEndpointToFile(configPath, newEndpointConfig);
    }
    else {
        const { provider } = await configureProvider();
        const newEndpointConfig = await configureEndpoint();
        const configContent = `import { FileUploadModuleOptions } from '@appxdigital/appx-core';

export const fileUploadConfig: FileUploadModuleOptions = {
    cloudProvider: '${provider}',
    endpoints: [
${objectToTypeScript(newEndpointConfig, 2)}
    ],
};`;
        fs.mkdirSync(path.dirname(configPath), { recursive: true });
        fs.writeFileSync(configPath, configContent);
        let appModuleContent = fs.readFileSync(appModulePath, 'utf-8');
        if (!appModuleContent.includes(`import { fileUploadConfig } from './config/file-upload.config';`)) {
            appModuleContent = `import { fileUploadConfig } from './config/file-upload.config';\n` + appModuleContent;
        }
        appModuleContent = appModuleContent.replace(/AppxCoreModule\.forRoot\(([^)]+)\)/, 'AppxCoreModule.forRoot(PermissionsConfig, fileUploadConfig)');
        fs.writeFileSync(appModulePath, appModuleContent);
    }
}
main().catch((error) => {
    console.error('Error during file upload configuration:', error);
});
