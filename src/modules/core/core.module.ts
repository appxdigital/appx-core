import {Module, Global} from '@nestjs/common';
import {DefaultRole} from '../../common/enums/role.enum';
import {RbacGuard} from '../../common/guards/rbac.guard';
import {PermissionsConfigProvider} from "../../common/config/permissions.config.provider";

interface CoreModuleOptions {
    rolesEnum?: typeof DefaultRole;
}

@Global()
@Module({
    providers: [PermissionsConfigProvider, RbacGuard],
    exports: [PermissionsConfigProvider, RbacGuard],
})
export class CoreModule {
}
