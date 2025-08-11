import {Module} from '@nestjs/common';
import {RbacGuard} from '../common/guards/rbac.guard';
import {UserPopulationGuard} from "../common/guards/user-population.guard";

@Module({
    providers: [RbacGuard, UserPopulationGuard],
    exports: [RbacGuard, UserPopulationGuard],
})
export class CommonModule {}
