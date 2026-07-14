import { PermissionPlaceholder, PermissionsConfigType } from '@appxdigital/appx-core';

/**
 * Shared condition: a USER can access a Project when they are the owner OR
 * a member. Lifted into a const so multiple resource rules can share it —
 * the same pattern real consumers use (see nebula-backend).
 *
 * Exercises:
 *   - OR at the top level
 *   - direct field match (ownerId)
 *   - list relation `some` (members)
 *   - nested USER_ID placeholder substitution at two levels
 */
const ProjectAccessCondition = {
  OR: [{ ownerId: PermissionPlaceholder.USER_ID }, { members: { some: { userId: PermissionPlaceholder.USER_ID } } }],
};

export const PermissionsConfig: PermissionsConfigType = {
  // -------- User --------
  User: {
    ADMIN: {
      findFirst: 'ALL',
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      // Can only see + edit themselves
      findFirst: { conditions: { id: PermissionPlaceholder.USER_ID } },
      findMany: { conditions: { id: PermissionPlaceholder.USER_ID } },
      updateMany: {
        conditions: { id: PermissionPlaceholder.USER_ID },
        // Even on self, USER cannot mutate role or move to another tenant
        restrictedFields: ['role', 'tenantId'],
      },
    },
  },

  // -------- Tenant --------
  // Multi-tenant scope: a USER only sees the tenant they belong to.
  // Exercises a list-relation condition (`users: { some: { id: $USER_ID } }`).
  Tenant: {
    ADMIN: {
      findFirst: 'ALL',
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findFirst: { conditions: { users: { some: { id: PermissionPlaceholder.USER_ID } } } },
      findMany: { conditions: { users: { some: { id: PermissionPlaceholder.USER_ID } } } },
    },
  },

  // -------- Project --------
  // Exercises OR + list-relation `some` + tighter rules for write actions
  // (only owner can update/delete, but any member can read).
  // The `create` rule pins `conditions` is silently
  // ignored on create today, so a USER can post a Project with any ownerId.
  // `setUserIdField` is the only mitigation the framework provides.
  Project: {
    ADMIN: {
      findFirst: 'ALL',
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findFirst: { conditions: ProjectAccessCondition },
      findMany: { conditions: ProjectAccessCondition },
      updateMany: { conditions: { ownerId: PermissionPlaceholder.USER_ID } },
      deleteMany: { conditions: { ownerId: PermissionPlaceholder.USER_ID } },
      create: {
        conditions: { ownerId: PermissionPlaceholder.USER_ID },
        setUserIdField: 'ownerId',
      },
    },
  },

  // -------- ProjectMember --------
  // A USER sees the membership rows of any project they have access to —
  // exercises nested-relation lookups one level deep (`{ project: <cond> }`).
  ProjectMember: {
    ADMIN: {
      findFirst: 'ALL',
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findMany: { conditions: { project: ProjectAccessCondition } },
      findFirst: { conditions: { project: ProjectAccessCondition } },
      // Only project owner can add/remove members
      create: { conditions: { project: { ownerId: PermissionPlaceholder.USER_ID } } },
      deleteMany: { conditions: { project: { ownerId: PermissionPlaceholder.USER_ID } } },
    },
  },

  // -------- Task --------
  // Two-level nested condition: Task → Project → OR
  // Also has an optional belongsTo (`assigneeId`) — exercises the proxy's
  // null-allowed code path when a task has no assignee.
  Task: {
    ADMIN: {
      findFirst: 'ALL',
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findFirst: { conditions: { project: ProjectAccessCondition } },
      findMany: { conditions: { project: ProjectAccessCondition } },
      updateMany: { conditions: { project: ProjectAccessCondition } },
      create: { conditions: { project: ProjectAccessCondition } },
      deleteMany: { conditions: { project: { ownerId: PermissionPlaceholder.USER_ID } } },
    },
  },

  // -------- Comment --------
  // Three-level nested condition: Comment → Task → Project → OR.
  // Different rules for read (any project participant) vs edit/delete (author only).
  Comment: {
    ADMIN: {
      findFirst: 'ALL',
      findMany: 'ALL',
      create: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findFirst: { conditions: { task: { project: ProjectAccessCondition } } },
      findMany: { conditions: { task: { project: ProjectAccessCondition } } },
      updateMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
      deleteMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
      create: {
        conditions: { task: { project: ProjectAccessCondition } },
        setUserIdField: 'authorId',
      },
    },
  },
};
