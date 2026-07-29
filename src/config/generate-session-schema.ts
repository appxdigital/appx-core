import * as path from 'path';
import * as fs from 'fs';

const schemaPath = path.join(process.cwd(), 'prisma/schema/schema.prisma');
const sessionSchemaPath = path.join(process.cwd(), 'prisma/schema/session.prisma');

/**
 * Check if the "Session" model exists in schema.prisma
 * @returns {boolean} - True if the Session model exists, otherwise false.
 */
const doesSessionModelExist = (): boolean => {
    if (fs.existsSync(schemaPath)) {
        const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
        const sessionModelRegex = /model\s+session\s*{[\s\S]*?}/i;
        return sessionModelRegex.test(schemaContent);
    }
    return false;
};

/**
 * Read the type of `User.id` from schema.prisma so the generated `Session.userId`
 * foreign key matches it. A consumer who changes `User.id` to `String` (uuid/cuid)
 * must not have an `Int` FK written back by tooling. Defaults to `Int` when the
 * User model or its id can't be found.
 */
const getUserIdType = (): string => {
    if (!fs.existsSync(schemaPath)) return 'Int';
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    const userModel = schemaContent.match(/model\s+User\s*{[\s\S]*?}/i);
    if (!userModel) return 'Int';
    const idField = userModel[0].match(/^\s*id\s+(\w+)/m);
    return idField ? idField[1] : 'Int';
};

/**
 * Ensure that the session schema exists if it is not already defined in schema.prisma
 */
const ensureSessionSchemaExists = () => {
    if (doesSessionModelExist()) {
        console.log('Session model already exists in schema.prisma. Skipping creation of session.prisma.');
        return;
    }

    if (!fs.existsSync(sessionSchemaPath)) {
        console.log('Session schema not found in session.prisma. Creating it...');

        const userIdType = getUserIdType();
        const sessionSchemaContent = `
      model Session {
        id        String   @id
        sid       String   @unique
        data      String
        expiresAt DateTime
        userId    ${userIdType}?
      }
    `;

        fs.writeFileSync(sessionSchemaPath, sessionSchemaContent);
        console.log('Session schema created successfully in session.prisma.');
    } else {
        console.log('Session schema already exists in session.prisma.');
    }
};

ensureSessionSchemaExists();
