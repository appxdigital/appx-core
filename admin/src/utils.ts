import * as path from 'path';
import {PermissionsConfigType, PrismaService} from "@appxdigital/appx-core";

export const dynamicImport = async (packageName: string) =>
    new Function(`return import('${packageName}')`)();

/**
 * The project's Prisma models (Prisma DMMF), from its generated client.
 */
export const loadAllModels = (): any[] => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const {Prisma} = require(path.join(process.cwd(), 'node_modules', '@prisma/client'));
    return Prisma.dmmf.datamodel.models as any[];
};

export function createPermissionHandler(
    role: string,
    resource: string,
    action: string,
    permissionConfig: PermissionsConfigType,
) {
    const rolePermissions = permissionConfig[resource]?.[role];

    if (!rolePermissions) {
        return () => false;
    }

    const actionMapping: {
        [key: string]: string | string[];
    } = {
        list: ['findMany', 'findFirst'],
        show: ['findFirst', 'findMany'],
        edit: 'updateMany',
        delete: 'delete',
        new: 'create',
    };

    let mappedAction = actionMapping[action];
    if (!Array.isArray(mappedAction))
        mappedAction = [mappedAction];

    for (const act of mappedAction) {
        if (!rolePermissions[act]) {
            continue;
        }

        if (rolePermissions[act] === 'ALL') {
            return () => true;
        }

        if (typeof rolePermissions[act] === 'object') {
            return () => true;
            // TODO granular permissions with db query (cached)
            return (requestContext: any) => {
                // @ts-ignore
                let conditions = rolePermissions[act]?.conditions;
                if (!conditions) return () => false;
                conditions = PrismaService._buildConditions(
                    conditions,
                    requestContext.currentAdmin,
                );
                const record = requestContext.record;
                // Overlay conditions with record values if available
                // Todo validation is shallow
                if (record) {
                    for (const key in conditions) {
                        if (record.params[key] !== conditions[key]) {
                            return false;
                        }
                    }
                }
                return conditions;
            };
        }
    }

    return () => false;
}

export const createActions = (permissionConfig: PermissionsConfigType) => {
    return {
        list: {
            isAccessible: createIsAccessible('list', permissionConfig),
        },
        show: {
            isAccessible: createIsAccessible('show', permissionConfig),
        },
        edit: {
            isAccessible: createIsAccessible('edit', permissionConfig),
        },
        delete: {
            isAccessible: createIsAccessible('delete', permissionConfig),
        },
        new: {
            isAccessible: createIsAccessible('new', permissionConfig),
        },
    };
};

const createIsAccessible = (action: string, permissionConfig: PermissionsConfigType) => {
    return (context: any) => {
        if (!context.currentAdmin) return false;
        const {role} = context.currentAdmin;
        return createPermissionHandler(
            role,
            context.resource.model.name,
            action,
            permissionConfig
        )(context);
    };
};
