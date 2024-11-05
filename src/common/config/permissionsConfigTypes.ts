export interface FieldConditions {
    [key: string]: any;
}

export interface Clause {
    type: 'OR' | 'field';
    conditions: FieldConditions | FieldConditions[];
}

export interface RolePermissions {
    findUnique?: 'ALL' | { clauses: Clause[] };
    findMany?: 'ALL' | { clauses: Clause[] };
    update?: 'ALL' | { clauses: Clause[] };
    delete?: 'ALL' | { clauses: Clause[] };
    create?: 'ALL' | { setUserIdField: string };
    findOne?: 'ALL' | { field: string; condition: FieldConditions };
}

export interface ModelPermissions {
    [role: string]: RolePermissions;
}

export interface PermissionsConfigType {
    [model: string]: ModelPermissions;
}
