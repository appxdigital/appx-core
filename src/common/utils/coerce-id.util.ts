import {BadRequestException} from '@nestjs/common';

/**
 * The shape we need off a Prisma model delegate: its runtime field metadata.
 * A delegate (e.g. `prisma.user`) exposes `fields.id.typeName` — the scalar
 * type name of the primary key ('String', 'Int', 'BigInt', …). This passes
 * through the PrismaService proxy unchanged (the proxy only wraps method calls).
 */
export interface IdBearingDelegate {
    fields?: {id?: {typeName?: string}};
}

/**
 * Coerce an id — as it arrives over HTTP (route params) or from a session
 * (always a string) — to the runtime type the model's primary key expects.
 *
 * String primary keys (uuid/cuid) pass through unchanged; every other PK type
 * is converted with `Number()`, matching Prisma's expectation for `Int` ids.
 * The type is read from the delegate's own field metadata, so this is correct
 * whether `User.id` is `Int @default(autoincrement())` or `String @default(uuid())`.
 *
 * This is the single source of truth for id coercion — generic CRUD
 * (`CoreService`) and the auth module both call it, so a string-keyed model
 * behaves consistently everywhere. Do NOT reintroduce `Number(id)` / `parseInt`
 * at call sites: `Number('3f2a…')` is `NaN` and `parseInt('3f2a…', 10)` is `3`,
 * i.e. a silent wrong-row lookup for UUID ids.
 */
export function coerceId(delegate: IdBearingDelegate, id: string | number): string | number {
    const idField = delegate?.fields?.id;
    if (!idField) {
        throw new BadRequestException(`Model does not have an 'id' field`);
    }
    return idField.typeName === 'String' ? String(id) : Number(id);
}
