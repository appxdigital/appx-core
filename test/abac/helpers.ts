/**
 * ABAC matrix harness. Runs the real PrismaService proxy (the security
 * boundary) against the isolated `appx_abac` database, reusing the fixture's
 * generated client (built from the rich schema in globalSetup).
 *
 * `withConfig(delta, fn)` builds a proxy whose permissions are the base
 * `abacPermissions` deep-merged with a per-test delta, then tears it down.
 * `asUser` (re-exported from the shared helper) impersonates the actor.
 */
import * as path from 'path';
import { PrismaService } from '../../src/prisma/prisma.service';
import type { PermissionsConfigType } from '../../src/common/config/permissionsConfigTypes';
import { FIXTURE_DIR } from './../helpers/fixture-app';
import { abacPermissions } from './permissions';

export { asUser } from '../helpers/test-module';

function abacUrl(): string {
    const url = process.env.APPX_ABAC_DB_URL;
    if (!url) {
        throw new Error(
            'APPX_ABAC_DB_URL not set — jest globalSetup did not stand up appx_abac. ' +
                '(Is APPX_SKIP_FIXTURE=1?)',
        );
    }
    return url;
}

/** The fixture's generated client is built from the rich schema; reuse it. */
export function newRawClient(): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PrismaClient } = require(path.join(FIXTURE_DIR, 'node_modules', '.prisma', 'client'));
    return new PrismaClient({ datasourceUrl: abacUrl() });
}

function deepMerge(base: any, delta: any): any {
    if (delta === undefined) return base;
    if (
        base === null ||
        delta === null ||
        typeof base !== 'object' ||
        typeof delta !== 'object' ||
        Array.isArray(base) ||
        Array.isArray(delta)
    ) {
        return delta;
    }
    const out: any = { ...base };
    for (const k of Object.keys(delta)) {
        out[k] = k in base ? deepMerge(base[k], delta[k]) : delta[k];
    }
    return out;
}

export async function buildAbacModule(
    perms: PermissionsConfigType,
): Promise<{ prisma: PrismaService; rawClient: any; close: () => Promise<void> }> {
    const rawClient = newRawClient();
    await rawClient.$connect();
    const prisma = new PrismaService(rawClient as any, perms as any);
    return {
        prisma,
        rawClient,
        close: async () => {
            await rawClient.$disconnect();
        },
    };
}

/**
 * Run `fn` against a proxy configured with `abacPermissions` deep-merged with
 * `delta` (delta wins). The delta only overrides the models/actions the test
 * needs; everything else falls back to the base.
 */
export async function withConfig<T>(delta: any, fn: (prisma: PrismaService) => Promise<T>): Promise<T> {
    const merged = deepMerge(abacPermissions, delta);
    const { prisma, close } = await buildAbacModule(merged);
    try {
        return await fn(prisma);
    } finally {
        await close();
    }
}
