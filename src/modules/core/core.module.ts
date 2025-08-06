import {Module, Global} from '@nestjs/common';
import {DefaultRole} from '../../common/enums/role.enum';
import {RbacGuard} from '../../common/guards/rbac.guard';
import {PermissionsConfigProvider} from "../../common/config/permissions.config.provider";
import {UserPopulationGuard} from "../../common/guards/user-population.guard";

interface CoreModuleOptions {
    rolesEnum?: typeof DefaultRole;
}

@Global()
@Module({
    providers: [PermissionsConfigProvider, RbacGuard, UserPopulationGuard],
    exports: [PermissionsConfigProvider, RbacGuard, UserPopulationGuard],
})
export class CoreModule {
}
