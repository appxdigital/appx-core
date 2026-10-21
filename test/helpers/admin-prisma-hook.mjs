/**
 * ESM resolve hook for test/helpers/admin-boot.cjs. `@adminjs/prisma` (ESM)
 * imports `@prisma/client`, which from this repo resolves to the root's
 * ungenerated client; a project has one generated client. Point the specifier
 * at the fixture's generated client.
 */
let client;
export async function initialize(data) {
    client = data.client;
}
export async function resolve(specifier, context, next) {
    return next(specifier === '@prisma/client' ? client : specifier, context);
}
