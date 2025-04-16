import {Module} from '@nestjs/common';
import {RbacGuard} from '../common/guards/rbac.guard';

@Module({
    providers: [RbacGuard],
    exports: [RbacGuard],
})
export class CommonModule {}
