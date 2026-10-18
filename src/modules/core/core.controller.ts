import {Body, Delete, Get, Inject, Param, Post, Put, UseGuards,} from '@nestjs/common';
import {CoreService} from './core.service';
import {Permission} from '../../common/decorators/permission.decorator';
import {RbacGuard} from '../../common/guards/rbac.guard';
import {PermissionsService} from "../../common/config/permissions.service";

@UseGuards(RbacGuard)
export abstract class CoreController<T> {
    static get entityName(): string {
        return '';
    }

    protected constructor(
        protected readonly service: CoreService<T>,
    ) {
    }

    @Inject(PermissionsService)
    protected readonly permissionsService!: PermissionsService;

    @Get()
    @Permission('findMany')
    async findAll() {
        return this.service.findAll({});
    }

    @Get(':id')
    @Permission('findFirst')
    async findOne(@Param('id') id: string) {
        return this.service.findById(id);
    }

    @Post()
    @Permission('create')
    async create(@Body() data: Partial<T> & {[key: string]: any}) {
        return this.service.create(data);
    }


    @Put(':id')
    @Permission('updateMany')
    async update(@Param('id') id: string, @Body() data: Partial<T>) {
        return this.service.updateById(id, data);
    }

    @Delete(':id')
    @Permission('deleteMany')
    async delete(@Param('id') id: string) {
        return this.service.deleteById(id);
    }
}
