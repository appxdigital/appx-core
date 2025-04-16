export interface FieldConditions {
    [key: string]: any;
}

export interface RolePermissions {
    [action: string]: 'ALL' | ActionPermission;
}

export interface ActionPermission {
    conditions: FieldConditions | FieldConditions[];
    setUserIdField?: string;
    restrictedFields?: string[];
}

export interface ModelPermissions {
    [role: string]: RolePermissions;
}

export interface PermissionsConfigType {
    [model: string]: ModelPermissions;
}
