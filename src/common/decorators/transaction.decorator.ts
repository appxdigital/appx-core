import {SetMetadata} from '@nestjs/common';

/**
 * A custom decorator to indicate whether a transaction should be used for a specific method or class.
 *
 * @param {boolean} [useTransaction=true] - Flag that specifies whether to use a transaction.
 *
 */
export const UseTransaction = (useTransaction: boolean = true) =>
    SetMetadata('useTransaction', useTransaction);
