import {
    applyDecorators,
    SetMetadata,
    UseGuards,
    Logger,
} from '@nestjs/common';
import {RolesGuard} from '../guards/role.guard';

export function GuardMethod(roles: string[]) {
    return applyDecorators(SetMetadata('roles', roles), UseGuards(RolesGuard));
}

export function applyMethodGuards(
    target: any,
    guardedMethods: {[key: string]: string[]},
) {
    const logger = new Logger('applyMethodGuards');
    for (const [methodName, roles] of Object.entries(guardedMethods)) {
        const descriptor = Object.getOwnPropertyDescriptor(
            target.prototype,
            methodName,
        );
        if (descriptor) {
            GuardMethod(roles)(target.prototype, methodName, descriptor);
            Object.defineProperty(target.prototype, methodName, descriptor);
        } else {
            logger.warn(`Method ${methodName} not found on ${target.name}`);
        }
    }
}
