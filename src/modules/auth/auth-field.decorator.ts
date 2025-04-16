import 'reflect-metadata';

/**
 * A decorator to mark a property in a class as the username or password field
 * for local authentication.
 *
 * @param {('username' | 'password')} type - Specifies if the field is a username or password.
 * @returns A decorator function that stores metadata about the field in the class constructor.
 */
export function AuthField(type: 'username' | 'password') {
    return (target: any, propertyKey: string | symbol) => {
        const existingFields =
            Reflect.getMetadata('authFields', target.constructor) || {};
        existingFields[type] = propertyKey;
        Reflect.defineMetadata('authFields', existingFields, target.constructor);
    };
}
