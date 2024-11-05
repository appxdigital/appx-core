import * as path from 'path';
import * as fs from 'fs';

const sessionSchemaPath = path.join(
    process.cwd(),
  'prisma/schema/session.prisma',
);

/**
 * Ensure that the session schema exists
 */
const ensureSessionSchemaExists = () => {
  if (!fs.existsSync(sessionSchemaPath)) {
    console.log('Session schema not found. Creating it...');

    const sessionSchemaContent = `
      model Session {
        id        String   @id @default(cuid())
        sid       String   @unique
        data      String
        expiresAt DateTime
        userId    Int?
      }
    `;

    fs.writeFileSync(sessionSchemaPath, sessionSchemaContent);
    console.log('Session schema created successfully.');
  } else {
    console.log('Session schema already exists.');
  }
};

ensureSessionSchemaExists();
