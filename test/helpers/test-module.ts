import { Test, TestingModule } from '@nestjs/testing';
import { RequestContext } from 'nestjs-request-context';
import { PrismaService, CorePrismaContext } from '../../src/prisma/prisma.service';
import type { PermissionsConfigType } from '../../src/common/config/permissionsConfigTypes';
import { loadGeneratedClient } from './test-db';

/**
 * Build a Nest TestingModule that wires a real PrismaService against the test
 * container, using the supplied permissions config.
 *
 * Returns { module, prisma, prismaClient } — prismaClient is the raw generated
 * client (so tests can BYPASS the proxy for setup/teardown), prisma is the
 * proxy-wrapped service under test.
 */
export async function buildTestModule(
    permissionsConfig: PermissionsConfigType,
): Promise<{
    module: TestingModule;
    prisma: PrismaService;
    rawClient: any;
}> {
    const generated = await loadGeneratedClient();
    const rawClient = new generated.PrismaClient();
    await rawClient.$connect();

    const module = await Test.createTestingModule({
        providers: [
            { provide: 'PERMISSIONS_CONFIG', useValue: permissionsConfig },
            {
                provide: PrismaService,
                useFactory: () => new PrismaService(rawClient, permissionsConfig),
            },
        ],
    }).compile();

    return {
        module,
        prisma: module.get(PrismaService),
        rawClient,
    };
}

/**
 * Truncate every model in the test schema. Uses the raw client to bypass ABAC.
 */
export async function resetDb(rawClient: any): Promise<void> {
    // Order matters: dependent first.
    await rawClient.post.deleteMany({});
    await rawClient.category.deleteMany({});
    await rawClient.user.deleteMany({});
    await rawClient.tenant.deleteMany({});
}

/**
 * Run a callback inside a nestjs-request-context with a synthetic user.
 * The proxy reads `RequestContext.currentContext.req.user` to determine role.
 *
 * `user = null` simulates an unauthenticated/GUEST request.
 * `exposedModels` optionally pre-fills CorePrismaContext (mimics the
 * @Permission('x', ['model']) decorator's bypass behaviour).
 */
export async function asUser<T>(
    user: { id?: number; role: string } | null,
    fn: () => Promise<T>,
    exposedModels: string[] = [],
): Promise<T> {
    const req: any = { user: user ?? undefined };
    const ctx = new RequestContext(req, {});
    return new Promise<T>((resolve, reject) => {
        RequestContext.cls.run(ctx, () => {
            CorePrismaContext.run({ exposedModels }, () => {
                fn().then(resolve, reject);
            });
        });
    });
}
