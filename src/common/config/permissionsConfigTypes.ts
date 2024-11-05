export interface FieldConditions {
    [key: string]: any;
}

export interface Clause {
    type: 'OR' | 'field';
    conditions: FieldConditions | FieldConditions[];
}

export interface RolePermissions {
    [action: string]: 'ALL' | { clauses: Clause[] } | { setUserIdField: string };
}

export interface ModelPermissions {
    [role: string]: RolePermissions;
}

export interface PermissionsConfigType {
    [model: string]: ModelPermissions;
}
