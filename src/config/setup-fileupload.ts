const fs = require('fs');
const path = require('path');
const inquirer = require('inquirer').default || require('inquirer');

const FileTypes = {
    IMAGE: 'image',
    DOCUMENT: 'document',
    VIDEO: 'video',
    AUDIO: 'audio'
};
type FileType = keyof typeof MimeTypes;

const MimeTypes = {
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    document: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    video: ['video/mp4', 'video/avi', 'video/mpeg'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/ogg']
};

async function configureFileUpload() {
    const { provider } = await inquirer.prompt([
        {
            type: 'list',
            name: 'provider',
            message: 'Select the storage provider:',
            choices: ['aws', 'gcp', 'local'],
        }
    ]);

    let providerConfig: { [key: string]: string } = {};
    if (provider === 'aws') {
        providerConfig = await inquirer.prompt([
            { name: 'bucket', message: 'Enter AWS S3 bucket name:' },
            { name: 'region', message: 'Enter AWS region:' },
            { name: 'accessKeyId', message: 'Enter AWS access key ID:' },
            { name: 'secretAccessKey', message: 'Enter AWS secret access key:' },
        ]);
    } else if (provider === 'gcp') {
        providerConfig = await inquirer.prompt([
            { name: 'bucket', message: 'Enter GCP bucket name:' },
            { name: 'projectId', message: 'Enter GCP project ID:' },
            { name: 'keyFilePath', message: 'Enter the path to the GCP service account key file:' },
        ]);
    }

    const envContent = Object.entries(providerConfig)
        .map(([key, value]) => `${key.toUpperCase()}=${value}`)
        .join('\n');
    fs.appendFileSync(path.resolve(process.cwd(), '.env'), `\n${envContent}\n`);

    const { endpoint, maxSize, fileType, multiple } = await inquirer.prompt([
        {
            name: 'endpoint',
            message: 'Enter the endpoint (e.g., "avatar" for /upload/avatar):'
        },
        {
            name: 'maxSize',
            message: 'Enter the maximum file size (in bytes):',
            validate: (input: string) => {
                const value = Number(input);
                return !isNaN(value) && value > 0
                    ? true
                    : 'Please enter a valid positive number';
            },
            filter: (input: string) => Number(input),
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
            message: 'Allow multiple file uploads?'
        },
    ]);

    let allowedTypes: string[] = [];
    if (fileType in MimeTypes) {
        const { selectedMimeTypes } = await inquirer.prompt([
            {
                type: 'checkbox',
                name: 'selectedMimeTypes',
                message: `Select allowed MIME types for ${fileType}:`,
                choices: MimeTypes[fileType as FileType],
                validate: (choices: string[]) => choices.length > 0 ? true : 'You must select at least one MIME type.'
            }
        ]);
        allowedTypes = selectedMimeTypes;
    }

    const { roles } = await inquirer.prompt([
        {
            name: 'roles',
            message: 'Enter allowed roles (comma-separated, or "ALL" for unrestricted access):',
            filter: (input: string) => input.split(',').map(role => role.trim())
        }
    ]);

    const configContent = `import { FileUploadModuleOptions } from 'appx_core';

export const fileUploadConfig: FileUploadModuleOptions = {
    cloudProvider: '${provider}',
    cloudProviderOptions: {
        ${Object.entries(providerConfig)
        .map(([key, value]) => `${key}: '${value}'`)
        .join(',\n        ')}
    },
    endpoints: [
        {
            endpoint: '/upload/${endpoint}',
            maxSize: ${maxSize},
            allowedTypes: ${JSON.stringify(allowedTypes)},
            multiple: ${multiple},
            roles: ${JSON.stringify(roles)},
        },
    ],
};`;

    const configPath = path.resolve(process.cwd(), 'src/config/file-upload.config.ts');
    fs.writeFileSync(configPath, configContent);

    console.log('Configuration saved to .env and src/config/file-upload.config.ts');
}

module.exports = { configureFileUpload };
