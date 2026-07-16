import { RequestContext } from 'nestjs-request-context';
import { CorePrismaContext } from '../../src/prisma/prisma.service';

/**
 * Run a callback inside a nestjs-request-context with a synthetic user.
 * The proxy reads `RequestContext.currentContext.req.user` to determine role.
 *
 * `user = null` simulates an unauthenticated/GUEST request.
 * `exposedModels` optionally pre-fills CorePrismaContext (mimics the
 * @Permission('x', ['model']) decorator's bypass behaviour).
 *
 * The proxy harness itself (buildAbacModule / withConfig) lives in
 * test/abac/helpers.ts; this shared helper is just the request-context wrapper.
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
