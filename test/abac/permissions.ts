import { PermissionPlaceholder } from '../../src/common/config/permissionsConfigTypes';
import type { PermissionsConfigType } from '../../src/common/config/permissionsConfigTypes';

/**
 * Base permissions for the ABAC relation matrix (§1). Keyed on the rich
 * fixture schema (Tenant / User / Project / ProjectMember / Task / Comment +
 * UserProfile / Tag). Most matrix tests install a per-test delta via
 * `withConfig(...)`; this base is the fallback for models a test doesn't
 * override.
 */
const $UID = PermissionPlaceholder.USER_ID;

/**
 * Shared condition constant — a project is accessible to a USER if they own it
 * or are a member. Mirrors the shape a real consumer writes and reuses across
 * rules (see nebula-backend's permissions.config.ts).
 */
export const ProjectAccessCondition: any = {
    OR: [{ ownerId: $UID }, { members: { some: { userId: $UID } } }],
};

const ADMIN_ALL = {
    findFirst: 'ALL',
    findMany: 'ALL',
    create: 'ALL',
    connect: 'ALL', // Option A: creating a row with FK references needs connect on the targets
    updateMany: 'ALL',
    deleteMany: 'ALL',
} as any;

export const abacPermissions: PermissionsConfigType = {
    Tenant: {
        ADMIN: ADMIN_ALL,
        USER: { findFirst: 'ALL', findMany: 'ALL', connect: 'ALL' },
    },
    User: {
        ADMIN: ADMIN_ALL,
        USER: {
            // Self OR direct reports (self-relation hierarchy) — §1.0.2 / §1.4.
            findFirst: { conditions: { OR: [{ id: $UID }, { managerId: $UID }] } },
            findMany: { conditions: { OR: [{ id: $UID }, { managerId: $UID }] } },
            // A USER is referenceable as a relation target (owner/assignee/author/…);
            // create tests override this per-test to exercise connect denial.
            connect: 'ALL',
            updateMany: { conditions: { id: $UID } },
        },
    },
    UserProfile: {
        ADMIN: ADMIN_ALL,
        USER: {
            findFirst: { conditions: { userId: $UID } },
            findMany: { conditions: { userId: $UID } },
            updateMany: { conditions: { userId: $UID } },
        },
    },
    Project: {
        ADMIN: ADMIN_ALL,
        USER: {
            findMany: { conditions: ProjectAccessCondition },
            findFirst: { conditions: ProjectAccessCondition },
            connect: 'ALL',
        },
    },
    ProjectMember: {
        ADMIN: ADMIN_ALL,
        USER: {
            findMany: { conditions: { userId: $UID } },
            findFirst: { conditions: { userId: $UID } },
        },
    },
    Task: {
        ADMIN: ADMIN_ALL,
        USER: {
            findMany: { conditions: { project: ProjectAccessCondition } },
            findFirst: { conditions: { project: ProjectAccessCondition } },
            connect: 'ALL',
        },
    },
    Comment: {
        ADMIN: ADMIN_ALL,
        USER: {
            findMany: { conditions: { authorId: $UID } },
            findFirst: { conditions: { authorId: $UID } },
            connect: 'ALL',
        },
    },
    Tag: {
        ADMIN: { findFirst: 'ALL', findMany: 'ALL', create: 'ALL', deleteMany: 'ALL' } as any,
        USER: {
            findMany: { conditions: { projects: { some: ProjectAccessCondition } } },
            findFirst: { conditions: { projects: { some: ProjectAccessCondition } } },
        },
    },
} as any;
