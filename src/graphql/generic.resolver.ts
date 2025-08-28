import {Args, Info, Query, Resolver} from '@nestjs/graphql';
import {Type} from '../common/types';
import {PrismaSelect} from '@paljs/plugins';
import {GraphQLResolveInfo} from 'graphql';
import {applyMethodGuards} from '../common/decorators/guard.decorator';
import {PrismaService} from '../prisma/prisma.service';

export function GenericResolverFactory<ModelType,
    CreateInput,
    UpdateInput,
    WhereInput,
    WhereUniqueInput,
    FindManyArgsType,
    AggregateArgsType,
    AggregateOutputType,
    CreateManyArgsType,
    CreateManyInput,
    >(
    model: string,
    returnType: Type<ModelType>,
    createInputType: Type<CreateInput>,
    updateInputType: Type<UpdateInput>,
    whereInputType: Type<WhereInput>,
    whereUniqueInputType: Type<WhereUniqueInput>,
    findManyArgsType: Type<FindManyArgsType>,
    aggregateArgsType: Type<AggregateArgsType>,
    aggregateOutputType: Type<AggregateOutputType>,
    createManyArgsType: Type<CreateManyArgsType>,
    createManyInputType: Type<CreateManyInput>,
    guardedMethods?: {[key: string]: string[]},
) {
    @Resolver({isAbstract: true})
    class GenericResolverClass {
        constructor(public readonly prisma: PrismaService) {
            if (guardedMethods) {
                applyMethodGuards(GenericResolverClass, guardedMethods);
            }
        }

        @Query(() => [returnType], {
            name: `findAll${model.charAt(0).toUpperCase() + model.slice(1)}s`,
        })
        async findAll(
            @Args({type: () => findManyArgsType, nullable: true})
                args: FindManyArgsType,
            @Info() info: GraphQLResolveInfo,
        ): Promise<ModelType[]> {
            const select = new PrismaSelect(info).value;
            const modelDelegate = this.prisma.getModelDelegate(model);
            return await modelDelegate.findMany({
                ...args,
                ...select,
            });
        }

        @Query(() => returnType, {
            name: `findOne${model.charAt(0).toUpperCase() + model.slice(1)}`,
        })
        async findOne(
            @Args('where', {type: () => whereUniqueInputType, nullable: false})
                where: WhereUniqueInput,
            @Info() info: GraphQLResolveInfo,
        ): Promise<ModelType> {
            const select = new PrismaSelect(info).value;
            const modelDelegate = this.prisma.getModelDelegate(model);
            return modelDelegate.findFirst({
                where,
                ...select,
            });
        }

        @Query(() => returnType, {
            name: `findFirst${model.charAt(0).toUpperCase() + model.slice(1)}`,
        })
        async findFirst(
            @Args({type: () => findManyArgsType, nullable: true})
                args: FindManyArgsType,
            @Info() info: GraphQLResolveInfo,
        ): Promise<ModelType> {
            const select = new PrismaSelect(info).value;
            const modelDelegate = this.prisma.getModelDelegate(model);
            return modelDelegate.findFirst({
                ...args,
                ...select,
            });
        }

        @Query(() => aggregateOutputType, {
            name: `aggregate${model.charAt(0).toUpperCase() + model.slice(1)}`,
        })
        async aggregate(
            @Args({type: () => aggregateArgsType, nullable: true})
                args: AggregateArgsType,
            @Info() info: GraphQLResolveInfo,
        ): Promise<AggregateOutputType> {
            const select = new PrismaSelect(info).value;
            const modelDelegate = this.prisma.getModelDelegate(model);
            return modelDelegate.aggregate({
                ...args,
                ...select,
            });
        }

        /*
                @Mutation(() => returnType, {
                    name: `delete${model.charAt(0).toUpperCase() + model.slice(1)}`,
                })
                async delete(
                    @Args('where', {type: () => whereUniqueInputType, nullable: false})
                        where: WhereUniqueInput,
                    @Info() info: GraphQLResolveInfo,
                ): Promise<ModelType> {
                    const select = new PrismaSelect(info).value;
                    const modelDelegate = this.prisma.getModelDelegate(model);
                    return modelDelegate.delete({
                        where,
                        ...select,
                    });
                }

                @Mutation(() => returnType, {
                    name: `create${model.charAt(0).toUpperCase() + model.slice(1)}`,
                })
                async create(
                    @Args('data', {type: () => createInputType}) data: CreateInput,
                    @Info() info: GraphQLResolveInfo,
                    @Context() ctx: any,
                ): Promise<ModelType> {
                    const select = new PrismaSelect(info).value;
                    const prisma = ctx.prisma || this.prisma.getModelDelegate(model);
                    return prisma.create({
                        data,
                        ...select,
                    });
                }

                @Mutation(() => returnType, {
                    name: `update${model.charAt(0).toUpperCase() + model.slice(1)}`,
                })
                async update(
                    @Args('where', {type: () => whereUniqueInputType, nullable: false})
                        where: WhereUniqueInput,
                    @Args('data', {type: () => updateInputType}) data: UpdateInput,
                    @Info() info: GraphQLResolveInfo,
                    @Context() ctx: any,
                ): Promise<ModelType> {
                    const select = new PrismaSelect(info).value;
                    const prisma = ctx.prisma || this.prisma.getModelDelegate(model);
                    return prisma.update({
                        where,
                        data,
                        ...select,
                    });
                }

                @Mutation(() => BatchPayload, {
                    name: `createMany${model.charAt(0).toUpperCase() + model.slice(1)}s`,
                })
                async createMany(
                    @Context() ctx: any,
                    @Args('data', {type: () => [createManyInputType]})
                        data: CreateManyInput[],
                    @Args('skipDuplicates', {type: () => Boolean, nullable: true})
                        skipDuplicates?: boolean,
                ): Promise<BatchPayload> {
                    const prisma = ctx.prisma || this.prisma.getModelDelegate(model);
                    if (!prisma) {
                        throw new Error('Transaction Prisma client not available in context.');
                    }
                    return prisma.createMany({
                        data,
                        skipDuplicates: skipDuplicates ?? false,
                    });
                }

                @Mutation(() => BatchPayload, {
                    name: `updateMany${model.charAt(0).toUpperCase() + model.slice(1)}s`,
                })
                async updateMany(
                    @Context() ctx: any,
                    @Args('where', {type: () => whereInputType, nullable: true})
                        where: WhereInput,
                    @Args('data', {type: () => updateInputType, nullable: false})
                        data: UpdateInput,
                ): Promise<BatchPayload> {
                    const prisma = ctx.prisma || this.prisma.getModelDelegate(model);
                    return prisma.updateMany({
                        where,
                        data,
                    });
                }

                @Mutation(() => BatchPayload, {
                    name: `deleteMany${model.charAt(0).toUpperCase() + model.slice(1)}s`,
                })
                async deleteMany(
                    @Context() ctx: any,
                    @Args('where', {type: () => whereInputType, nullable: true})
                        where: WhereInput,
                ): Promise<BatchPayload> {
                    const prisma = ctx.prisma || this.prisma.getModelDelegate(model);
                    return prisma.deleteMany({
                        where,
                    });
                }

                @Mutation(() => returnType, {
                    name: `upsert${model.charAt(0).toUpperCase() + model.slice(1)}`,
                })
                async upsert(
                    @Context() ctx: any,
                    @Args('where', {type: () => whereUniqueInputType, nullable: false})
                        where: WhereUniqueInput,
                    @Args('create', {type: () => createInputType}) create: CreateInput,
                    @Args('update', {type: () => updateInputType}) update: UpdateInput,
                    @Info() info: GraphQLResolveInfo,
                ): Promise<ModelType> {
                    const select = new PrismaSelect(info).value;
                    const prisma = ctx.prisma || this.prisma.getModelDelegate(model);
                    return prisma.upsert({
                        where,
                        create,
                        update,
                        ...select,
                    });
                }
            }
            */

    }

    return GenericResolverClass;
}
