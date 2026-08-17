import 'reflect-metadata';
import { inject } from 'vitest';

declare module 'vitest' {
  export interface ProvidedContext {
    testDbUrl: string;
  }
}

process.env.NODE_ENV = 'test';

// The suite runs against the throwaway container provisioned in
// test/global-setup.ts — never the database in `.env`. Overriding DB_URL here,
// before any app or PrismaClient is constructed, is what guarantees that:
// dotenv/ConfigModule never override an env var that is already set.
const testDbUrl = inject('testDbUrl');
if (!testDbUrl) {
  throw new Error(
    'Test database not provisioned — run the suite via `npm test` so vitest.config.ts applies.',
  );
}
process.env.DB_URL = testDbUrl;
process.env.APPX_TEST_DB = testDbUrl;
