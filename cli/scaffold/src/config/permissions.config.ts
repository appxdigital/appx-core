import {PermissionPlaceholder, PermissionsConfigType,} from '@appxdigital/appx-core';

export const PermissionsConfig: PermissionsConfigType = {
    User: {
        ADMIN: {
            findFirst: 'ALL',
            findMany: 'ALL',
            create: 'ALL',
            updateMany: 'ALL',
            deleteMany: 'ALL',
        },
        CLIENT: {
            findFirst: {
                conditions: {id: PermissionPlaceholder.USER_ID},
            },
        }
    },
};
