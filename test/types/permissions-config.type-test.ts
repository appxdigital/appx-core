/**
 * TYPE contract for the permissions config shape. A role block must accept the
 * known write actions, the dedicated `connect` action, AND the relation-scoped
 * `relations` map — all in one literal, WITHOUT `as any`. Regression guard for
 * the index-signature collision that made `relations` unusable when typed.
 */
import type { RolePermissions } from '../../src/common/config/permissionsConfigTypes';

// A fully-typed role block using every extension point at once.
const role: RolePermissions = {
    create: 'ALL',
    updateMany: { conditions: {} as any },
    connect: { conditions: {} as any },
    relations: {
        owner: { connect: 'ALL' },
        teacher: { connect: { conditions: {} as any } },
    },
};

// Relation-only role (no target-model connect) must also type-check.
const relOnly: RolePermissions = {
    create: 'ALL',
    relations: { owner: { connect: 'ALL' } },
};

// Custom RBAC-only action keys remain allowed (routing labels).
const custom: RolePermissions = {
    findMany: 'ALL',
    publish: 'ALL',
};

// Server-set values on a write rule.
const withSet: RolePermissions = {
    create: { set: { ownerId: '$USER_ID', status: 'draft' } },
    updateMany: { conditions: {} as any, set: { updatedById: '$USER_ID' } },
};

const badSet: RolePermissions = {
    // @ts-expect-error — `set` maps columns to values, not a column name
    create: { set: 'ownerId' },
};

// Row-conditional field visibility.
const withFields: RolePermissions = {
    findMany: 'ALL',
    fields: { email: { visibleOnlyWhen: { id: '$USER_ID' } } },
    relations: { owner: { connect: 'ALL' } },
};

const badFieldRule: RolePermissions = {
    // @ts-expect-error — a field rule is `{ visibleOnlyWhen }`, not a bare value
    fields: { email: 'ALL' },
};

const missingVisibleOnlyWhen: RolePermissions = {
    // @ts-expect-error — `visibleOnlyWhen` is required
    fields: { email: { conditions: { id: '$USER_ID' } } },
};

void withFields;
void badFieldRule;
void missingVisibleOnlyWhen;
void withSet;
void badSet;
void role;
void relOnly;
void custom;
