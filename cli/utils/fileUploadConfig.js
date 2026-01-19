import fs from 'fs';
import path from 'path';
import inquirer from 'inquirer';

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

function getEnvVariables(provider, providerOptions) {
    if (provider === 'aws') {
        return {
            AWS_BUCKET_NAME: providerOptions.bucket,
            AWS_REGION: providerOptions.region,
            AWS_ACCESS_KEY_ID: providerOptions.accessKeyId,
            AWS_SECRET_ACCESS_KEY: providerOptions.secretAccessKey,
        };
    } else if (provider === 'gcp') {
        return {
            GCP_BUCKET_NAME: providerOptions.bucket,
            GCP_PROJECT_ID: providerOptions.projectId,
            GCP_KEY_FILE_PATH: providerOptions.keyFilePath,
        };
    } else {
        return {};
    }
}

export async function gatherFileUploadSettings() {
    const config = {};

    const {provider} = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: 'Select the storage provider:',
            choices: ['aws', 'gcp', 'local'],
        },
    ]);
    config.provider = provider;

    if (provider === 'aws') {
        config.providerOptions = await inquirer.prompt([
            {type: 'input', name: 'bucket', message: 'Enter AWS S3 bucket name:'},
            {type: 'input', name: 'region', message: 'Enter AWS region:'},
            {type: 'input', name: 'accessKeyId', message: 'Enter AWS access key ID:'},
            {type: 'input', name: 'secretAccessKey', message: 'Enter AWS secret access key:'},
        ]);
    } else if (provider === 'gcp') {
        config.providerOptions = await inquirer.prompt([
            {type: 'input', name: 'bucket', message: 'Enter GCP bucket name:'},
            {type: 'input', name: 'projectId', message: 'Enter GCP project ID:'},
            {type: 'input', name: 'keyFilePath', message: 'Enter the path to the GCP service account key file:'},
        ]);
    }

    const {endpoint, maxSize, fileType, multiple} = await inquirer.prompt([
        {
            type: 'input',
            name: 'endpoint',
            message: 'Enter the endpoint (e.g., "avatar" for /upload/avatar):',
        },
        {
            type: 'input',
            name: 'maxSize',
            message: 'Enter the maximum file size (in MB):',
            validate: (input) =>
                !isNaN(Number(input)) && Number(input) > 0
                    ? true
                    : 'Please enter a valid positive number',
            filter: (input) => Number(input) * 1024 * 1024,
        },
        {
            type: 'list',
            name: 'fileType',
            message: 'Select file category:',
            choices: ['image', 'document', 'video', 'audio'],
        },
        {
            type: 'confirm',
            name: 'multiple',
            message: 'Allow multiple file uploads?',
            default: false,
        },
    ]);

    config.endpoint = endpoint;
    config.maxSize = maxSize;
    config.fileType = fileType;
    config.multiple = multiple;

    if (fileType in MimeTypes) {
        const {selectedMimeTypes} = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selectedMimeTypes',
                message: `Select allowed MIME types for ${fileType}:`,
                choices: MimeTypes[fileType],
                validate: (choices) => (choices.length > 0 ? true : 'You must select at least one MIME type.'),
            },
        ]);
        config.allowedTypes = selectedMimeTypes;
    }

    const {roles} = await inquirer.prompt([
        {
            type: 'input',
            name: 'roles',
            message: 'Enter allowed roles (comma-separated, or "ALL" for unrestricted access):',
            filter: (input) => input.split(',').map((role) => role.trim()),
        },
    ]);
    config.roles = roles;

    return config;
}

export function insertFileUploadConfiguration(config, projectPath) {
    const providerOptions = config.providerOptions || {};
    const envVariables = getEnvVariables(config.provider, providerOptions);

    const envContent = Object.entries(envVariables)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');

    const devEnvPath = path.resolve(projectPath, '.env');
    if (envContent) {
        fs.appendFileSync(devEnvPath, `\n${envContent}\n`);
    }

    const configContent = `import { FileUploadModuleOptions } from '@appxdigital/appx-core';

export const fileUploadConfig: FileUploadModuleOptions = {
    cloudProvider: '${config.provider}',
    endpoints: [
        {
            endpoint: '/upload/${config.endpoint}',
            aliases: [],
            maxSize: ${config.maxSize},
            allowedTypes: ${JSON.stringify(config.allowedTypes, null, 8)},
            multiple: ${config.multiple},
            roles: ${JSON.stringify(config.roles, null, 8)},
        },
    ],
};`;

    const configPath = path.resolve(projectPath, 'src/config/file-upload.config.ts');
    fs.writeFileSync(configPath, configContent);

    const appModulePath = path.resolve(projectPath, 'src/app.module.ts');
    let appModuleContent = fs.readFileSync(appModulePath, 'utf-8');

    if (!appModuleContent.includes(`import { fileUploadConfig } from './config/file-upload.config';`)) {
        appModuleContent = `import { fileUploadConfig } from './config/file-upload.config';\n` + appModuleContent;
    }

    appModuleContent = appModuleContent.replace(
        /AppxCoreModule\.forRoot\(([^)]+)\)/,
        'AppxCoreModule.forRoot(PermissionsConfig, fileUploadConfig)'
    );

    fs.writeFileSync(appModulePath, appModuleContent);
}
