import {
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards, Inject,
} from '@nestjs/common';
import { CoreService } from './core.service';
import { Permission } from '../../common/decorators/permission.decorator';
import { RbacGuard } from '../../common/guards/rbac.guard';
import {RequestContext} from "nestjs-request-context";
import {PermissionsService} from "../../common/config/permissions.service";

@UseGuards(RbacGuard)
export abstract class CoreController<T> {
  static get entityName(): string {
    return '';
  }
  protected constructor(
      protected readonly service: CoreService<T>,
  ) {}

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
    return this.service.findOne({ id: Number(id) });
  }

  @Post()
  @Permission('create')
  async create(@Body() data: any) {
    const user =    RequestContext.currentContext.req.user
    const model = (this.constructor as typeof CoreController).entityName;
    const rolePermissions = this.permissionsService.getPermissionsConfig()[model]?.[user.role];

    if (rolePermissions?.create && rolePermissions.create !== 'ALL' && rolePermissions.create.setUserIdField) {
      const userIdField = rolePermissions.create.setUserIdField;
      data[userIdField] = user.id;
    }
    return this.service.create(data);
  }

  @Put(':id')
  @Permission('update')
  async update(@Param('id') id: string, @Body() data: any) {
    return this.service.update({ id: Number(id) }, data);
  }

  @Delete(':id')
  @Permission('delete')
  async delete(@Param('id') id: string) {
    return this.service.delete({ id: Number(id) });
  }
}
