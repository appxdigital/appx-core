/**
 * Unit tests for `coerceId` — the single source of truth for turning an id that
 * arrives as a string (route param / session) into the runtime type the model's
 * primary key expects. This is the logic the auth module was missing, which made
 * session auth fail for string (uuid/cuid) `User.id`.
 */
import { coerceId } from '../../src/common/utils/coerce-id.util';
import { BadRequestException } from '@nestjs/common';

const stringPk = { fields: { id: { typeName: 'String' } } };
const intPk = { fields: { id: { typeName: 'Int' } } };
const bigIntPk = { fields: { id: { typeName: 'BigInt' } } };

const UUID = '3f2a1c9e-2b7d-4a6f-9c11-8e5b2d0a7f42';

describe('coerceId', () => {
    describe('String primary key (uuid/cuid)', () => {
        it('passes a uuid through unchanged (was NaN under Number())', () => {
            expect(coerceId(stringPk, UUID)).toBe(UUID);
        });

        it('keeps a numeric-looking string AS a string', () => {
            // The bug that motivated this: a uuid beginning with digits would be
            // truncated by parseInt. A String PK must never be num-coerced.
            expect(coerceId(stringPk, '12345')).toBe('12345');
            expect(typeof coerceId(stringPk, '12345')).toBe('string');
        });

        it('stringifies a numeric input for a String PK', () => {
            expect(coerceId(stringPk, 7)).toBe('7');
        });
    });

    describe('Int primary key (autoincrement)', () => {
        it('converts a numeric string to a number', () => {
            expect(coerceId(intPk, '5')).toBe(5);
            expect(typeof coerceId(intPk, '5')).toBe('number');
        });

        it('leaves a number as a number', () => {
            expect(coerceId(intPk, 5)).toBe(5);
        });
    });

    it('coerces any non-String PK with Number() (documents BigInt behaviour)', () => {
        expect(coerceId(bigIntPk, '9')).toBe(9);
    });

    describe('missing id metadata', () => {
        it('throws BadRequestException when the model has no id field', () => {
            expect(() => coerceId({ fields: {} }, UUID)).toThrow(BadRequestException);
        });

        it('throws when the delegate has no fields metadata', () => {
            expect(() => coerceId({} as any, UUID)).toThrow(BadRequestException);
        });
    });
});
