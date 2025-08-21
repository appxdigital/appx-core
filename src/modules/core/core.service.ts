import {BadRequestException, Injectable, NotFoundException} from '@nestjs/common';
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
     * @param options - Additional query options (e.g., include, select)
     * @returns A promise of the record
     */
    async findOne(where: any, options: any = {}): Promise<T> {
        const record = this.modelDelegate.findUnique({
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
        const record = await this.modelDelegate.findUnique({
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
            return await this.modelDelegate.update({
                where: this._generateWhereFromIdField(id),
                data,
            });
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
            return await this.modelDelegate.delete({
                where: this._generateWhereFromIdField(id)
            });
        } catch (error) {
            handleError(error);
        }
    }

    /*
      * Generates a 'where' clause based on the model's ID field. Depending on the type of the ID field, it may convert the ID to a number.
     */
    private _generateWhereFromIdField(id: string | number): any {
        let idField = this.modelDelegate.fields.id;
        if (!idField) {
            throw new BadRequestException(`Model does not have an 'id' field`);
        }
        if (idField.typeName != "String") {
            id = Number(id);
        }
        return {id: id};
    }
}
