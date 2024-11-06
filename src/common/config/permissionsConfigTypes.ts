export interface FieldConditions {
    [key: string]: any;
}

export interface Clause {
    type: 'OR' | 'field';
    conditions: FieldConditions | FieldConditions[];
}

export interface RolePermissions {
    [action: string]: 'ALL' | ActionPermission;
}

export interface ActionPermission {
    clauses?: Clause[];
    setUserIdField?: string;
    restrictedFields?: string[];
}

export interface ModelPermissions {
    [role: string]: RolePermissions;
}

export interface PermissionsConfigType {
    [model: string]: ModelPermissions;
}
