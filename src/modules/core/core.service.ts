import {Injectable, NotFoundException} from '@nestjs/common';
import {PrismaService} from '../../prisma/prisma.service';
import {RequestContext} from 'nestjs-request-context';

@Injectable()
export class CoreService<T> {
    constructor(
        protected readonly prisma: PrismaService,
        protected readonly modelDelegate: any,
    ) {
    }

    /**
     * Find all records with optional parameters and permission conditions.
     * @param params - Additional query parameters (e.g., filters, order, etc.)
     * @returns A promise of an array of records
     */
    async findAll(params: any = {}): Promise<T[]> {
        const prisma = RequestContext.currentContext.req.prisma;
        try {
            return await prisma[this.modelDelegate.name.toLowerCase()].findMany(params);
        } catch (error) {
            this.prisma.handleError(error);
            throw error;
        }
    }

    /**
     * Find a single record by unique identifier.
     * @param where - Unique identifier for the record (e.g., { id: 1 })
     * @returns A promise of the record
     */
    async findOne(where: any): Promise<T | null> {
        const prisma = RequestContext.currentContext.req.prisma;
        const record = await prisma[this.modelDelegate.name.toLowerCase()].findUnique({where});
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
        const prisma = RequestContext.currentContext.req.prisma;
        try {
            return await prisma[this.modelDelegate.name].create({data});
        } catch (error) {
            this.prisma.handleError(error);
            throw error;
        }
    }

    /**
     * Update an existing record with permission conditions.
     * @param where - Unique identifier.
     * @param data - Data to update.
     * @returns A promise of the updated record.
     */
    async update(where: any, data: any): Promise<T> {
        const prisma = RequestContext.currentContext.req.prisma;
        try {
            return await prisma[this.modelDelegate.name].update({
                where,
                data,
            });
        } catch (error) {
            this.prisma.handleError(error);
        }
    }

    /**
     * Delete a record.
     * @param where - Unique identifier for the record (e.g., { id: 1 })
     * @returns A promise of the deleted record
     */
    async delete(where: any): Promise<T> {
        const prisma = RequestContext.currentContext.req.prisma;
        try {
            return await prisma[this.modelDelegate.name.toLowerCase()].delete({where});
        } catch (error) {
            this.prisma.handleError(error);
            throw error;
        }
    }
}
