import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';
import type { TestProject } from 'vitest/node';

/**
 * Provisions a throwaway database container for the whole test run, pushes the
 * Prisma schema into it, and hands its URL to the workers. The database in
 * `.env` is never touched — `npm test` needs only Docker.
 */
export default async function globalSetup(project: TestProject) {
  // Read .env only to learn the provider; the database itself is disposable.
  const env = config({ path: resolve(__dirname, '../.env'), processEnv: {} }).parsed ?? {};
  const provider = (env.DB_PROVIDER || process.env.DB_PROVIDER || 'mysql').toLowerCase();

  let url: string;
  let stop: () => Promise<unknown>;

  if (provider === 'postgresql' || provider === 'postgres') {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const container = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('app_test')
      .withUsername('test')
      .withPassword('test')
      .start();
    url = container.getConnectionUri();
    stop = () => container.stop({ timeout: 10_000 });
  } else {
    const { MySqlContainer } = await import('@testcontainers/mysql');
    const container = await new MySqlContainer('mysql:8.0')
      .withDatabase('app_test')
      .withUsername('test')
      .withUserPassword('test')
      .start();
    url = container.getConnectionUri();
    stop = () => container.stop({ timeout: 10_000 });
  }

  try {
    execSync('npx prisma db push --skip-generate', {
      cwd: resolve(__dirname, '..'),
      env: { ...process.env, DB_URL: url },
      stdio: 'pipe',
    });
  } catch (error: any) {
    await stop();
    throw new Error(`prisma db push failed against the test container:\n${error.stdout || error.message}`);
  }

  project.provide('testDbUrl', url);

  return async () => {
    await stop();
  };
}
