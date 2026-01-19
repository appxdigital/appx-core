import * as fs from 'fs';

export const kebabToPascalCase = (str: string) => {
    return str
        .split("-")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join("");
};

export const createFileIfNotExists = (filePath: string, content: string) => {
    console.log(`Creating ${filePath}...`);
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, content);
        console.log(`${filePath} created.`);
    } else {
        console.log(`${filePath} already exists, skipping.`);
    }
};

export const IGNORE_FOLDERS = [
    'prisma',
    'schema.gql',
    'session',
    'user-refresh-token'
];