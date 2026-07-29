import {Injectable, NotFoundException} from '@nestjs/common';
import {handleError} from "../../common/utils/error-handler";
import {coerceId} from "../../common/utils/coerce-id.util";
import type {PrismaClient} from '.prisma/client';

@Injectable()
export class CoreService<T> {
    constructor(
        protected readonly modelDelegate: PrismaClient[T],
    ) {
    }

    /**
     * Find all records with optional parameters and permission conditions.
     * @param params - Additional query parameters (e.g., filters, order, etc.)
     * @returns A promise of an array of records
     */
    async findAll(params: any = {}): Promise<T[]> {
        try {
            return await this.modelDelegate.findMany(params);
        } catch (error) {
            handleError(error);
        }
    }

    /**
     * Find a single record by unique identifier.
     * @param where - Unique identifier for the record (e.g., { id: 1 })
     * @param options - Additional query options (e.g., include, select)
     * @returns A promise of the record
     */
    async findOne(where: any, options: any = {}): Promise<T> {
        const record = this.modelDelegate.findFirst({
            where,
            ...options
        });

        if (!record) {
            throw new NotFoundException(`Record with the given criteria not found`);
        }
        return record;
    }

    /**
     * Find a single record by unique identifier.
     * @param id - Unique identifier for the record (e.g., 1, 'abc123').
     * @returns A promise of the record
     */
    async findById(id: string): Promise<T> {
        const record = await this.modelDelegate.findFirst({
            where: this._generateWhereFromIdField(id)
        });
        if (!record) {
            throw new NotFoundException(`Record with the given criteria not found`);
        }
        return record;
    }

    /**
     * Create a new record.
     * @param data - Data for the new record.
     * @returns A promise of the created record.
     */
    async create(data: any): Promise<T> {
        try {
            return await this.modelDelegate.create({data});
        } catch (error) {
            handleError(error);
        }
    }

    /**
     * Update an existing record with permission conditions.
     * @param id - Unique identifier for the record (e.g., 1, 'abc123').
     * @param data - Data to update.
     * @returns A promise of the updated record.
     */
    async updateById(id: string | number, data: any): Promise<T> {
        try {
            return (await this.modelDelegate.updateMany({
                where: this._generateWhereFromIdField(id),
                data,
            }))[0];
        } catch (error) {
            handleError(error);
        }
    }

    /**
     * Delete a record by identifier.
     * @param id - Unique identifier for the record (e.g., 1, 'abc123').
     * @returns A promise of the deleted record
     */
    async deleteById(id: string | number): Promise<T> {
        try {
            return this.modelDelegate.deleteMany({
                where: this._generateWhereFromIdField(id)
            });
        } catch (error) {
            handleError(error);
        }
    }

    /*
      * Generates a 'where' clause based on the model's ID field. Coercion to the
      * PK's concrete type (String passes through, otherwise Number) is centralised
      * in `coerceId` and shared with the auth module.
     */
    private _generateWhereFromIdField(id: string | number): any {
        return {id: coerceId(this.modelDelegate, id)};
    }
}
