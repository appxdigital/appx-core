/**
 * @UseTransaction — per-endpoint override of USE_TRANSACTION (the fixture sets
 * it to `true`). Two test routes on the fixture app write a row and then fail:
 * inside the request transaction the write rolls back; with
 * `@UseTransaction(false)` the endpoint runs without one and the write stays.
 *
 * The decorator is taken from the package entry point, as a project imports it.
 */
import 'reflect-metadata';
import * as path from 'path';
import request from 'supertest';
import { BadRequestException, Controller, INestApplication, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FIXTURE_APP_MODULE_PATH, FIXTURE_DIR } from '../helpers/fixture-app';

describe('@UseTransaction (USE_TRANSACTION=true)', () => {
    let app: INestApplication;
    let rawPrisma: any;

    beforeAll(async () => {
        if (process.env.APPX_FIXTURE_DB_URL) process.env.DATABASE_URL = process.env.APPX_FIXTURE_DB_URL;
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const core = require(path.join(FIXTURE_DIR, 'node_modules', '@appxdigital', 'appx-core'));
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { AppModule } = require(FIXTURE_APP_MODULE_PATH);
        expect(core.UseTransaction).toBeInstanceOf(Function);

        const createThenFail = async (prisma: any, email: string) => {
            await prisma.user.create({ data: { email } }, { BYPASS_FILTERING: true });
            throw new BadRequestException('fail after write');
        };

        @Controller('tx-test')
        class TxTestController {
            constructor(private readonly prisma: any) {}

            @Post('default')
            byDefault() {
                return createThenFail(this.prisma, 'tx-default@example.com');
            }

            @Post('off')
            @core.UseTransaction(false)
            off() {
                return createThenFail(this.prisma, 'tx-off@example.com');
            }
        }
        Reflect.defineMetadata('design:paramtypes', [core.PrismaService], TxTestController);

        @Module({ imports: [AppModule], controllers: [TxTestController] })
        class TxTestApp {}

        app = await NestFactory.create(TxTestApp, { logger: false });
        await app.init();
        rawPrisma = app.get(core.PrismaService);
        await rawPrisma.user.deleteMany({ where: { email: { startsWith: 'tx-' } } }, { BYPASS_FILTERING: true });
    });

    afterAll(async () => {
        await rawPrisma?.user.deleteMany({ where: { email: { startsWith: 'tx-' } } }, { BYPASS_FILTERING: true });
        await app?.close();
    });

    const exists = (email: string) =>
        rawPrisma.user.count({ where: { email } }, { BYPASS_FILTERING: true });

    test('a failing endpoint rolls back its write inside the request transaction', async () => {
        const res = await request(app.getHttpServer()).post('/tx-test/default');
        expect(res.status).toBe(400);
        expect(await exists('tx-default@example.com')).toBe(0);
    });

    test('@UseTransaction(false) runs the endpoint without a transaction', async () => {
        const res = await request(app.getHttpServer()).post('/tx-test/off');
        expect(res.status).toBe(400);
        expect(await exists('tx-off@example.com')).toBe(1);
    });
});
