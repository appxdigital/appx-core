import {
    CanActivate,
    ExecutionContext,
    ForbiddenException, HttpException, Inject,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import {Reflector} from '@nestjs/core';
import {PERMISSION_METADATA_KEY} from '../decorators/permission.decorator';
import {PERMISSIONS_CONFIG_TOKEN} from '../config/permissions.config.provider';
import {PermissionsConfigType, RolePermissions, SINGULAR_ACTION} from "../config/permissionsConfigTypes";

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

        if (!model || model === '') {
            throw new HttpException('Entity name is not set. Please override method `static get entityName()` in the controller with the permissions entity.', 500);
        }

        const rolePermissions = this.permissionsConfig[model]?.[user.role];
        if (!rolePermissions) {
            throw new ForbiddenException(
                `No permissions defined for role ${user.role} on model ${model}`,
            );
        }
        // A `*Many` action inherits its singular rule when not defined explicitly
        // (createMany → create, updateMany → update, deleteMany → delete) — mirrors
        // the data-access proxy, so a config can declare just the singular form.
        let permission = rolePermissions[action];
        if (!permission && SINGULAR_ACTION[action as string]) {
            permission = rolePermissions[SINGULAR_ACTION[action as string] as keyof RolePermissions];
        }
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
