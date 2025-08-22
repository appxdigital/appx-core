import {
    Get,
    Post,
    Put,
    Delete,
    Param,
    Body,
    UseGuards, Inject,
} from '@nestjs/common';
import {CoreService} from './core.service';
import {Permission} from '../../common/decorators/permission.decorator';
import {RbacGuard} from '../../common/guards/rbac.guard';
import {RequestContext} from "nestjs-request-context";
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
    @Permission('findUnique')
    async findOne(@Param('id') id: string) {
        return this.service.findById(id);
    }

    @Post()
    @Permission('create')
    async create(@Body() data: any) {
        const user = RequestContext.currentContext.req.user;
        const role = user?.role || 'GUEST';
        const model = (this.constructor as typeof CoreController).entityName;
        const rolePermissions = this.permissionsService.getPermissionsConfig()[model]?.[role];
        const actionPermission = rolePermissions?.['create'];

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
    async update(@Param('id') id: string, @Body() data: any) {
        const user = RequestContext.currentContext.req.user;
        const role = user?.role || 'GUEST';
        const model = (this.constructor as typeof CoreController).entityName;
        const rolePermissions = this.permissionsService.getPermissionsConfig()[model]?.[role];
        const actionPermission = rolePermissions?.['update'];
        let restrictedFields: string[] = [];

        if (typeof actionPermission !== 'string' && actionPermission?.restrictedFields) {
            restrictedFields = actionPermission.restrictedFields;
        }

        for (const field of restrictedFields) {
            delete data[field];
        }
        return this.service.updateById(id, data);
    }

    @Delete(':id')
    @Permission('delete')
    async delete(@Param('id') id: string) {
        return this.service.deleteById(id);
    }
}
