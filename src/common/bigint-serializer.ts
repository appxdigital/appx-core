/**
 * `JSON.stringify` throws on a `bigint` ("Do not know how to serialize a
 * BigInt"), so any model with a Prisma `BigInt` column would 500 when a CRUD
 * endpoint serialises the row. Teach BigInt to serialise as its decimal string
 * in JSON output (HTTP responses, logs). Applied once, on import — imported for
 * its side effect by the core module, so it is active in every AppX Core app.
 *
 * String output pairs with `@BigIntField()` on the input side, which accepts a
 * string (or number) — so a BigInt round-trips as a string over HTTP.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
if (typeof (BigInt.prototype as any).toJSON !== 'function') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-extend-native
    (BigInt.prototype as any).toJSON = function (): string {
        return this.toString();
    };
}
