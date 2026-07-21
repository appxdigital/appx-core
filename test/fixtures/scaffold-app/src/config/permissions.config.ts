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
      connect: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      // Can only see + edit themselves
      findFirst: { conditions: { id: PermissionPlaceholder.USER_ID } },
      findMany: { conditions: { id: PermissionPlaceholder.USER_ID } },
      // A USER may be referenced as a relation target (project owner, task
      // assignee/reviewer, comment author, membership). Which USER is allowed is
      // constrained per-relation by the referencing model's create rule +
      // `setUserIdField`, so the connect rule itself is open.
      connect: 'ALL',
      updateMany: {
        // Even on self, USER cannot mutate role or move to another tenant —
        // those columns are `/// @NoWrite` in the schema (excluded for all roles).
        conditions: { id: PermissionPlaceholder.USER_ID },
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
      connect: 'ALL',
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
  // (only owner can update/delete, but any member can read). `create` pins the
  // owner to the caller (own-scalar condition + `setUserIdField`); `connect`
  // governs attaching an existing project as a relation target (task/membership).
  Project: {
    ADMIN: {
      findFirst: 'ALL',
      findMany: 'ALL',
      create: 'ALL',
      connect: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findFirst: { conditions: ProjectAccessCondition },
      findMany: { conditions: ProjectAccessCondition },
      // Attaching a project (as a task's or membership's parent) requires access to it.
      connect: { conditions: ProjectAccessCondition },
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
      connect: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findMany: { conditions: { project: ProjectAccessCondition } },
      findFirst: { conditions: { project: ProjectAccessCondition } },
      // Creating a membership is authorized by its FK references: the project
      // via Project.connect (access) and the user via User.connect.
      create: 'ALL',
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
      connect: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findFirst: { conditions: { project: ProjectAccessCondition } },
      findMany: { conditions: { project: ProjectAccessCondition } },
      // Attaching a task (as a comment's parent) requires access to its project.
      connect: { conditions: { project: ProjectAccessCondition } },
      updateMany: { conditions: { project: ProjectAccessCondition } },
      // The task's project is authorized via Project.connect (its projectId FK).
      create: 'ALL',
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
      connect: 'ALL',
      updateMany: 'ALL',
      deleteMany: 'ALL',
    },
    USER: {
      findFirst: { conditions: { task: { project: ProjectAccessCondition } } },
      findMany: { conditions: { task: { project: ProjectAccessCondition } } },
      updateMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
      deleteMany: { conditions: { authorId: PermissionPlaceholder.USER_ID } },
      // Attaching a parent comment (the optional self-relation) requires access
      // to a comment in a project you can see.
      connect: { conditions: { task: { project: ProjectAccessCondition } } },
      // author is forced to the caller (setUserIdField); the comment's task is
      // authorized via Task.connect (its taskId FK).
      create: {
        setUserIdField: 'authorId',
      },
    },
  },
};
