import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import session from 'express-session';
import passport from 'passport';
import {
  buildCoreSessionOptions,
  CorePrismaSessionStore,
  PrismaService,
  setupCoreSecurity,
} from '@appxdigital/appx-core';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const prismaService = await app.get(PrismaService);
  const secret = configService.get<string>('SESSION_SECRET');
  const port = configService.get<number>('APP_PORT') ?? 3000;
  const sessionTTL = configService.get<number>('SESSION_TTL') || 86400;
  const cookiename = configService.get<string>('SESSION_COOKIE_NAME');
  const corsOrigin =
    configService.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';

  app.use(
    session(
      buildCoreSessionOptions({
        secret,
        cookieName: cookiename,
        ttlSeconds: sessionTTL,
        store: new CorePrismaSessionStore(prismaService, { ttl: sessionTTL }),
      }),
    ),
  );
  app.use(passport.initialize());
  app.use(passport.session());
  setupCoreSecurity(app, {
    cors: { origin: corsOrigin, credentials: true },
  });
  await app.listen(port);
  console.log(`Your application is successfully running on: http://www.localhost:${port} 🚀`);
}

bootstrap();
