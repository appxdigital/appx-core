import {applyDecorators} from '@nestjs/common';
import {Transform} from 'class-transformer';
import {Validate, ValidatorConstraint, ValidatorConstraintInterface} from 'class-validator';

/**
 * DTO field decorators for Prisma `Decimal` and `BigInt` columns.
 *
 * Generated CRUD DTOs must type these columns as `Prisma.Decimal` / `bigint`
 * (the Prisma model types) so a controller override type-checks against
 * `CoreController<T>`. But JSON can't carry them and class-transformer doesn't
 * know how to build them. These decorators accept a **string or number** on the
 * wire and validate it; a value that isn't numeric yields a clean `400`.
 *
 * - `@DecimalField()` validates the value and passes it through unchanged —
 *   Prisma's create/update input accepts `string | number | Decimal` and coerces
 *   it to a real `Prisma.Decimal` on write. (We deliberately do NOT construct a
 *   `Prisma.Decimal` here: the framework's own bundled client is a stub, so a
 *   `require('@prisma/client').Prisma.Decimal` isn't reliably available at the
 *   framework's runtime location.)
 * - `@BigIntField()` coerces to a real `bigint` (Prisma's BigInt input doesn't
 *   accept a string); `BigInt()` is a global, so no client is involved.
 */

const isNullish = (v: unknown): boolean => v === null || v === undefined;

// A finite number, or a string that is a plain/scientific decimal literal.
const DECIMAL_STRING = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
function isDecimalWire(v: unknown): boolean {
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'string') {
        const s = v.trim();
        return s !== '' && DECIMAL_STRING.test(s);
    }
    return false;
}

function toBigInt(value: unknown): unknown {
    if (isNullish(value)) return value;
    if (Array.isArray(value)) return value.map(toBigInt);
    if (typeof value !== 'string' && typeof value !== 'number') return value;
    try {
        return BigInt(value as string | number);
    } catch {
        return value; // non-integer / garbage → validator produces a 400
    }
}

// Constraints reject nullish so a missing REQUIRED column fails with a clean 400;
// optional columns carry `@IsOptional`, which short-circuits before the
// constraint runs, so null/undefined is still accepted there.

@ValidatorConstraint({name: 'isDecimalInput', async: false})
export class IsDecimalInputConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (Array.isArray(value)) return value.every(isDecimalWire);
        return isDecimalWire(value);
    }
    defaultMessage(): string {
        return '$property must be a decimal (a numeric string or number)';
    }
}

@ValidatorConstraint({name: 'isBigIntInput', async: false})
export class IsBigIntInputConstraint implements ValidatorConstraintInterface {
    validate(value: unknown): boolean {
        if (Array.isArray(value)) return value.every((v) => typeof v === 'bigint');
        return typeof value === 'bigint';
    }
    defaultMessage(): string {
        return '$property must be an integer (a numeric string or number)';
    }
}

/**
 * Marks a DTO field as a Prisma `Decimal`: accepts a string or number on the
 * wire and validates it (Prisma coerces it to `Prisma.Decimal` on write). Pair
 * with `@IsOptional` for optional columns.
 */
export function DecimalField(): PropertyDecorator {
    return applyDecorators(Validate(IsDecimalInputConstraint));
}

/**
 * Marks a DTO field as a Prisma `BigInt`: accepts a string or number on the wire,
 * coerces it to `bigint`, and validates it. Pair with `@IsOptional` for optional
 * columns.
 */
export function BigIntField(): PropertyDecorator {
    return applyDecorators(
        Transform(({value}) => toBigInt(value)),
        Validate(IsBigIntInputConstraint),
    );
}
