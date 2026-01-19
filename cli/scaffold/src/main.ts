import {NestFactory} from '@nestjs/core';
import {AppModule} from './app.module';
import {ConfigService} from '@nestjs/config';
import session from 'express-session';
import passport from 'passport';
import {CorePrismaSessionStore, PrismaService} from '@appxdigital/appx-core';
import {ValidationPipe} from '@nestjs/common';
import morgan from 'morgan';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    const configService = app.get(ConfigService);
    const prismaService = await app.get(PrismaService);
    const secret = configService.get<string>('SESSION_SECRET');
    const port = configService.get<number>('APP_PORT') ?? 3000;
    const sessionTTL = configService.get<number>('SESSION_TTL') || 86400;
    const cookiename = configService.get<string>('SESSION_COOKIE_NAME');
    const isProduction = process.env.NODE_ENV === 'production';

    // Application request logging
    app.use(morgan('[:date[iso]] :remote-addr :method :url :status :response-time ms - :res[content-length]'));

    app.use(
        session({
            cookie: {
                maxAge: sessionTTL * 1000,
                secure: isProduction,
                httpOnly: isProduction,
            },
            secret: secret ?? 'APPXCORESECRET',
            resave: false,
            name: cookiename,
            saveUninitialized: false,
            store: new CorePrismaSessionStore(prismaService),
        }),
    );
    app.use(passport.initialize());
    app.use(passport.session());
    app.enableCors({
        origin: 'http://localhost:3000',
        credentials: true,
    });
    app.useGlobalPipes(new ValidationPipe({transform: true}));
    await app.listen(port);
    console.log(`Your application is successfully running on: http://www.localhost:${port} 🚀`);
}

bootstrap();
