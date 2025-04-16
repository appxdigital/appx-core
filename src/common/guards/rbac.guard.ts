import {
    CanActivate,
    ExecutionContext,
    ForbiddenException, Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {PERMISSION_METADATA_KEY} from '../decorators/permission.decorator';
import {PERMISSIONS_CONFIG_TOKEN} from '../config/permissions.config.provider';
import {PermissionsConfigType, RolePermissions} from "../config/permissionsConfigTypes";

@Injectable()
export class RbacGuard implements CanActivate {
    constructor(
        private reflector: Reflector,
        @Inject(PERMISSIONS_CONFIG_TOKEN) private permissionsConfig: PermissionsConfigType,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const permissionMetadata =
            this.reflector.get(PERMISSION_METADATA_KEY, context.getHandler()) || {};

        const action = permissionMetadata['action'] as keyof RolePermissions;

        if (!action) return true;

        const request = context.switchToHttp().getRequest();
        const user = {...request.user, role: request.user?.role || 'GUEST'};

        const controller = context.getClass() as any;
        const model = controller?.entityName;

        const rolePermissions = this.permissionsConfig[model]?.[user.role];
        if (!rolePermissions) {
            throw new UnauthorizedException(
                `No permissions defined for role ${user.role} on model ${model}`,
            );
        }
        const permission = rolePermissions[action];
        if (!permission) {
            throw new ForbiddenException(
                `Action ${action} not allowed for role ${user.role} on model ${model}`,
            );
        }
        if (permission === 'ALL') {
            return true;
        }

        return true;
    }
}
