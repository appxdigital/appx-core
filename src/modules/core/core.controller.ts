import {Body, Delete, Get, Inject, Param, Post, Put, UseGuards,} from '@nestjs/common';
import {CoreService} from './core.service';
import {Permission} from '../../common/decorators/permission.decorator';
import {RbacGuard} from '../../common/guards/rbac.guard';
import {RequestContext} from "nestjs-request-context";
import {PermissionsService} from "../../common/config/permissions.service";

interface CreatePermission<T> {
    [key: string]: any;

    setUserIdField?: keyof T;
}

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
    @Permission('findUnique')
    async findOne(@Param('id') id: string) {
        return this.service.findById(id);
    }

    @Post()
    @Permission('create')
    async create(@Body() data: Partial<T> & {[key: string]: any}) {
        const user = RequestContext.currentContext.req.user;
        const role = user?.role || 'GUEST';
        const model = (this.constructor as typeof CoreController).entityName;
        const rolePermissions = this.permissionsService.getPermissionsConfig()[model]?.[role];
        const actionPermission = rolePermissions?.['create'] as CreatePermission<T> | string;

        if (
            typeof actionPermission !== 'string' &&
            actionPermission?.setUserIdField
        ) {
            const userIdField = actionPermission.setUserIdField;
            data[userIdField] = user.id;
        }
        return this.service.create(data);
    }


    @Put(':id')
    @Permission('update')
    async update(@Param('id') id: string, @Body() data: Partial<T>) {
        const user = RequestContext.currentContext.req.user;
        const role = user?.role || 'GUEST';
        const model = (this.constructor as typeof CoreController).entityName;
        const rolePermissions = this.permissionsService.getPermissionsConfig()[model]?.[role];
        const actionPermission = rolePermissions?.['update'];
        let restrictedFields: string[] = [];

        if (typeof actionPermission !== 'string' && actionPermission?.restrictedFields) {
            restrictedFields = actionPermission.restrictedFields;
        }

        for (const field of restrictedFields as (keyof T)[]) {
            delete data[field];
        }
        return this.service.updateById(id, data);
    }

    @Delete(':id')
    @Permission('deleteMany')
    async delete(@Param('id') id: string) {
        return this.service.deleteById(id);
    }
}
