export const permissionsUtilsContent = `
import {PermissionsConfig} from "../config/permissions.config";

export const dynamicImport = async (packageName: string) =>
    new Function(\`return import('\${packageName}')\`)();

export const getAdminJSResources = (specific = null) => {
    const resources = [
        {
            name: 'User',
            options: {},
        },
    ];

    return specific ? resources.filter((r) => r.name === specific) : resources;
};

export function createPermissionHandler(role: string, resource: string, action: string) {
    const rolePermissions = PermissionsConfig[resource]?.[role];

    if (!rolePermissions) {
        return () => false;
    }

    const actionMapping = {
        list : 'findMany',
        show : 'findUnique',
        edit : 'update',
        delete : 'delete',
        new : 'create',
    };

    const mappedAction = actionMapping[action];

    if (!mappedAction || !rolePermissions[mappedAction]) {
        return () => false;
    }

    if (rolePermissions[mappedAction] === 'ALL') {
        return () => true;
    }

    if (typeof rolePermissions[mappedAction] === 'object') {

        return (requestContext) => {
            // @ts-ignore
            const clauses = rolePermissions[mappedAction]?.clauses;
            if (!clauses) return () => false;
            return parseClauses(clauses)(requestContext);
        };
    }

    return () => false;
}

const clauseMapping = {
    '$USER_ID': "id",
    '$USER_EMAIL': "email",
};

const parseClauses = (clauses) => {
    return (requestContext) => {
        if (!clauses || !Array.isArray(clauses)) return true;

        for (const clause of clauses) {
            if (clause.type === 'field') {
                for (const [field, value] of Object.entries(clause.conditions)) {
                    let actualValue = value;

                    if (typeof value === 'string' && value.startsWith('$')) {
                        actualValue = requestContext?.currentAdmin[clauseMapping[value]] ?? null;
                    }

                    if (requestContext.record?.param(field) !== actualValue) {
                        return false;
                    }
                }
            }
        }
        return true;
    };
};

export const addBasicFilters = (filters) => {
    return async (request, context) => {
        for (const [field, value] of Object.entries(filters)) {
            request.query[\`filters.\${field}\`] = value;
        }
        return request;
    };
};

export const createActions = () => {
    return {
        list: {
            isAccessible: createIsAccessible('list'),
        },
        show: {
            isAccessible: createIsAccessible('show'),
        },
        edit: {
            isAccessible: createIsAccessible('edit'),
        },
        delete: {
            isAccessible: createIsAccessible('delete'),
        },
        new: {
            isAccessible: createIsAccessible('new'),
        },
    };
};

const createIsAccessible = (action) => {
    return (context) => {
        if (!context.currentAdmin) return false;
        const { role } = context.currentAdmin;
        return createPermissionHandler(role, context.resource.model.name, action)(context);
    };
};

const createBeforeHook = (filters) => {
    return (request, context) => {
        if (context.currentAdmin) {
            request.query.filters = {
                ...request.query.filters,
                ...filters,
            };
        }
        return request;
    };
};
`;
