import {Injectable, NotFoundException} from '@nestjs/common';
import type {PrismaClient} from '.prisma/client';
import {handleError} from "../../common/utils/error-handler";

@Injectable()
export class CoreService<T> {
    constructor(
        protected readonly modelDelegate: PrismaClient[keyof PrismaClient],
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
     * @returns A promise of the record
     */
    async findOne(where: any): Promise<T | null> {
        const record = this.modelDelegate.findUnique({where});
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
     * @param where - Unique identifier.
     * @param data - Data to update.
     * @returns A promise of the updated record.
     */
    async update(where: any, data: any): Promise<T> {
        try {
            return await this.modelDelegate.update({
                where,
                data,
            });
        } catch (error) {
            handleError(error);
        }
    }

    /**
     * Delete a record.
     * @param where - Unique identifier for the record (e.g., { id: 1 })
     * @returns A promise of the deleted record
     */
    async delete(where: any): Promise<T> {
        try {
            return await this.modelDelegate.delete({where});
        } catch (error) {
            handleError(error);
        }
    }
}
