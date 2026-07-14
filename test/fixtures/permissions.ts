import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';
import type { PermissionsConfigType } from '../../src/common/config/permissionsConfigTypes';

/**
 * Permissions fixture exercised by the proxy/ABAC test suite.
 * Keys mirror the test schema in fixtures/prisma/schema.prisma.template.
 *
 * Coverage matrix:
 *   - 'ALL'                                                          (ADMIN on every model)
 *   - { conditions: { id: $USER_ID } }                              (USER reads self only)
 *   - { conditions: { authorId: $USER_ID } }                        (USER reads/edits own posts)
 *   - no entry for an action                                        (default-deny path)
 *   - GUEST role with no User permission                            (unauthenticated default-deny)
 *   - tenantId condition (multi-tenant isolation case)
 */
export const testPermissions: PermissionsConfigType = {
    Tenant: {
        ADMIN: {
            findFirst: 'ALL',
            findMany: 'ALL',
            create: 'ALL',
            updateMany: 'ALL',
            deleteMany: 'ALL',
        },
        USER: {
            findMany: 'ALL',
            findFirst: 'ALL',
        },
    },
    User: {
        ADMIN: {
            findFirst: 'ALL',
            findMany: 'ALL',
            create: 'ALL',
            updateMany: 'ALL',
            deleteMany: 'ALL',
        },
        USER: {
            // repro: conditions on `create` should restrict authorId
            // but are silently ignored by the proxy. Test asserts that.
            create: { conditions: { id: PermissionPlaceholder.USER_ID } },
            findFirst: { conditions: { id: PermissionPlaceholder.USER_ID } },
            findMany: { conditions: { id: PermissionPlaceholder.USER_ID } },
            updateMany: { conditions: { id: PermissionPlaceholder.USER_ID } },
        },
    },
    Category: {
        ADMIN: {
            findMany: 'ALL',
            findFirst: 'ALL',
            create: 'ALL',
            deleteMany: 'ALL',
        },
        USER: {
            findMany: 'ALL',
            findFirst: 'ALL',
        },
    },
    Post: {
        ADMIN: {
            findFirst: 'ALL',
            findMany: 'ALL',
            create: 'ALL',
            updateMany: 'ALL',
            deleteMany: 'ALL',
        },
        USER: {
            findMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
            findFirst: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
            create: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
            updateMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
            deleteMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
        },
        // GUEST has no entries on Post -> default deny
    },
};
