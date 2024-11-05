import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestContext } from 'nestjs-request-context';

@Injectable()
export class CoreService<T> {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly modelDelegate: any,
  ) {}

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
      console.error(`Error in findAll for model ${this.modelDelegate.name}:`, error);
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

    try {
      const record = await prisma[this.modelDelegate.name.toLowerCase()].findUnique({ where });

      if (!record) {
        console.error(`Record with the given criteria not found for model ${this.modelDelegate.name}`);
        throw new NotFoundException(`Record with the given criteria not found`);
      }
      return record;
    } catch (error) {
      console.error(`Error in findOne for model ${this.modelDelegate.name}:`, error);
      throw error;
    }
  }

  /**
   * Create a new record.
   * @param data - Data for the new record.
   * @returns A promise of the created record.
   */
  async create(data: any): Promise<T> {
    const prisma = RequestContext.currentContext.req.prisma;
    return await prisma[this.modelDelegate.name].create({ data });
  }

  /**
   * Update an existing record with permission conditions.
   * @param where - Unique identifier.
   * @param data - Data to update.
   * @returns A promise of the updated record.
   */
  async update(where: any, data: any): Promise<T> {
    const prisma = RequestContext.currentContext.req.prisma;
    return await prisma[this.modelDelegate.name].update({
      where,
      data,
    });
  }

  /**
   * Delete a record.
   * @param where - Unique identifier for the record (e.g., { id: 1 })
   * @returns A promise of the deleted record
   */
  async delete(where: any): Promise<T> {
    const prisma = RequestContext.currentContext.req.prisma;
    return await prisma[this.modelDelegate.name].delete({
      where,
    });
  }
}
