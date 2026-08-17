import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import session from 'express-session';
import passport from 'passport';
import request from 'supertest';
import {
  buildCoreSessionOptions,
  CorePrismaSessionStore,
  PrismaService,
  setupCoreSecurity,
} from '@appxdigital/appx-core';
import { AppModule } from '../../src/app.module';

// This guard lives in the harness itself, which every DB-touching spec imports
// directly, so it runs no matter how vitest was launched. The suite truncates
// tables — it must only ever see the container database from global-setup.
if (!process.env.APPX_TEST_DB || process.env.DB_URL !== process.env.APPX_TEST_DB) {
  throw new Error(
    `Refusing to run: DB_URL is not the test container database. Run the suite via \`npm test\`.`,
  );
}

/**
 * Raw Prisma client — bypasses the ABAC proxy on purpose. Fixture rows are
 * created and results asserted at the database level, so a broken permission
 * rule can't quietly produce an empty fixture and fake a pass.
 */
export const prisma = new PrismaClient();

let app: INestApplication | undefined;

/**
 * Boots the real AppModule once per spec file, applying the same middleware
 * stack as src/main.ts (session store, passport, setupCoreSecurity) so both
 * session and JWT auth behave exactly as they do in production.
 */
export async function startApp(): Promise<INestApplication> {
  if (app) return app;
  app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const configService = app.get(ConfigService);
  const prismaService = app.get(PrismaService);
  const sessionTTL = configService.get<number>('SESSION_TTL') || 86400;
  app.use(
    session(
      buildCoreSessionOptions({
        secret: configService.get<string>('SESSION_SECRET'),
        cookieName: configService.get<string>('SESSION_COOKIE_NAME'),
        ttlSeconds: sessionTTL,
        store: new CorePrismaSessionStore(prismaService, { ttl: sessionTTL }),
      }),
    ),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  setupCoreSecurity(app);
  await app.init();
  return app;
}

export async function stopApp() {
  if (app) {
    await app.close();
    app = undefined;
  }
  await prisma.$disconnect();
}

/** Deletes every row, children before parents. Extend as your schema grows. */
export async function truncateAll() {
  await prisma.userRefreshToken.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
}

export type Actor = { id: number; email: string; password: string; token: string };

/**
 * Mints a user over real HTTP (register + JWT login) and returns its bearer
 * token — actors go through the same door production traffic does.
 */
export async function registerActor(
  email = `user-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`,
  password = 'Password123!',
): Promise<Actor> {
  const server = (await startApp()).getHttpServer();
  const registered = await request(server).post('/auth/register').send({ email, password });
  if (registered.status >= 300) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
  }
  const login = await request(server).post('/auth/login/jwt').send({ email, password });
  if (login.status >= 300) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  const row = await prisma.user.findUnique({ where: { email } });
  return { id: row!.id, email, password, token: login.body.access_token };
}

/** A supertest agent carrying `actor`'s bearer token, or none for a guest. */
export function api(actor?: Actor) {
  if (!app) throw new Error('Call startApp() before api().');
  const agent = request(app.getHttpServer());
  if (!actor) return agent;
  const auth = `Bearer ${actor.token}`;
  return {
    get: (url: string) => agent.get(url).set('Authorization', auth),
    post: (url: string) => agent.post(url).set('Authorization', auth),
    put: (url: string) => agent.put(url).set('Authorization', auth),
    patch: (url: string) => agent.patch(url).set('Authorization', auth),
    delete: (url: string) => agent.delete(url).set('Authorization', auth),
  };
}

/** A cookie-keeping agent for session-auth flows (`POST /auth/login` → …). */
export function sessionAgent() {
  if (!app) throw new Error('Call startApp() before sessionAgent().');
  return request.agent(app.getHttpServer());
}
