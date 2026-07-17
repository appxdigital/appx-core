/**
 * Type-level contract test for the proxied Prisma client (compile-only; run via
 * `npm run type-check`, not jest). Imports the REAL exported types so drift in
 * `prisma.service.ts` breaks the type-check.
 *
 * It asserts both directions:
 *   - valid calls compile,
 *   - invalid calls are REJECTED (every `@ts-expect-error` must fire, otherwise
 *     tsc reports the unused directive and the check fails).
 *
 * Contract under test — `ProxiedDelegate<D>`:
 *   - re-aliases `update` → `updateMany`, `delete` → `deleteMany`,
 *     `findUnique` → `findFirst`, `findUniqueOrThrow` → `findFirstOrThrow`,
 *   - preserves every other method exactly;
 * and `CorePrismaClient<C>` maps delegates while leaving `$`-members intact.
 */
import type { ProxiedDelegate, CorePrismaClient } from '../../src/prisma/prisma.service';

// A delegate shaped like Prisma's generated ones (generic args, distinct *Args
// + return types). Args are strict enough that wrong-type / missing-required
// inputs fail to type-check.
type BatchPayload = { count: number };
type Row = { id: number; secret: string };
type FindManyArgs = { where?: { id?: number }; select?: object };
type FindFirstArgs = { where?: { id?: number }; select?: object };
type FindUniqueArgs = { where: { id: number } };
type UpdateArgs = { where: { id: number }; data: { secret?: string } };
type UpdateManyArgs = { where?: { id?: number; secret?: string }; data: { secret?: string } };
type DeleteArgs = { where: { id: number } };
type DeleteManyArgs = { where?: { id?: number; secret?: string } };

interface MockDelegate {
    findMany<T extends FindManyArgs>(args?: T): Promise<Row[]>;
    findFirst<T extends FindFirstArgs>(args?: T): Promise<Row | null>;
    findFirstOrThrow<T extends FindFirstArgs>(args?: T): Promise<Row>;
    findUnique<T extends FindUniqueArgs>(args: T): Promise<Row | null>;
    findUniqueOrThrow<T extends FindUniqueArgs>(args: T): Promise<Row>;
    update<T extends UpdateArgs>(args: T): Promise<Row>;
    updateMany<T extends UpdateManyArgs>(args: T): Promise<BatchPayload>;
    delete<T extends DeleteArgs>(args: T): Promise<Row>;
    deleteMany<T extends DeleteManyArgs>(args?: T): Promise<BatchPayload>;
    count(args?: object): Promise<number>;
}

interface MockClient {
    user: MockDelegate;
    $transaction<R>(fn: (c: unknown) => Promise<R>): Promise<R>;
    $connect(): Promise<void>;
}

type Expect<T extends true> = T;
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

type P = ProxiedDelegate<MockDelegate>;

/* ---- type-level shape assertions ---- */
type _u = Expect<Equal<P['update'], MockDelegate['updateMany']>>;
type _d = Expect<Equal<P['delete'], MockDelegate['deleteMany']>>;
type _fm = Expect<Equal<P['findMany'], MockDelegate['findMany']>>;
type _ff = Expect<Equal<P['findFirst'], MockDelegate['findFirst']>>;
// findUnique / findUniqueOrThrow re-aliased to their find* equivalents
type _fu = Expect<Equal<P['findUnique'], MockDelegate['findFirst']>>;
type _fut = Expect<Equal<P['findUniqueOrThrow'], MockDelegate['findFirstOrThrow']>>;

type PC = CorePrismaClient<MockClient>;
type _cu = Expect<Equal<PC['user'], ProxiedDelegate<MockDelegate>>>;
type _ctx = Expect<Equal<PC['$transaction'], MockClient['$transaction']>>;

/* ---- value-level: VALID calls must compile ---- */
async function valid(m: PC) {
    const r1: BatchPayload = await m.user.update({ where: { secret: 'x' }, data: { secret: 'y' } });
    const r2: BatchPayload = await m.user.delete({ where: { secret: 'x' } });
    const rows: Row[] = await m.user.findMany({ where: { id: 1 } });
    const one: Row | null = await m.user.findFirst({ where: { id: 1 } });
    // findUnique now takes findFirst's (non-unique) params and nullable return
    const uniq: Row | null = await m.user.findUnique({ where: { id: 1 } });
    const uniqOrThrow: Row = await m.user.findUniqueOrThrow({ where: { id: 1 } });
    return { r1, r2, rows, one, uniq, uniqOrThrow };
}

/* ---- value-level: INVALID calls must be REJECTED ---- */
function invalid(m: PC) {
    // @ts-expect-error findUnique is findFirst: result is nullable, not a bare Row
    const _badfu: Promise<Row> = m.user.findUnique({ where: { id: 1 } });
    // @ts-expect-error update() is updateMany: `data` is required
    m.user.update({ where: { id: 1 } });
    // @ts-expect-error update() is updateMany: `data.secret` must be a string
    m.user.update({ data: { secret: 123 } });
    // @ts-expect-error update() returns BatchPayload, not a fluent Row
    const _bad: Promise<Row> = m.user.update({ data: { secret: 'y' } });
    // @ts-expect-error delete() returns BatchPayload, not a Row
    const _baddel: Promise<Row> = m.user.delete({ where: { id: 1 } });
    void _badfu;
    void _bad;
    void _baddel;
}

export {};
void valid;
void invalid;
