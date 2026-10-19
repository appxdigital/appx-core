import {PermissionPlaceholder, PermissionsConfigType} from '@appxdigital/appx-core';

export const PermissionsConfig: PermissionsConfigType = {
    User: {
        ADMIN: {
            findFirst: 'ALL',
            findMany: 'ALL',
            create: 'ALL',
            updateMany: 'ALL',
            deleteMany: 'ALL',
        },
        USER: {
            findFirst: {
                conditions: {id: PermissionPlaceholder.USER_ID}, // Can only see its own user
            },
            // A column returned only on rows matching a condition (docs/permissions.md, "Field visibility per row"):
            // fields: {email: {visibleOnlyWhen: {id: PermissionPlaceholder.USER_ID}}},
        }
    },
};
