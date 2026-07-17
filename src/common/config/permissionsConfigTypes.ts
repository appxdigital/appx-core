// types/permissions.ts
import type {Prisma, PrismaClient as RuntimeClient} from '.prisma/client';
import {Operation} from '@prisma/client/runtime/library';

export const PermissionPlaceholder: {
    USER_ID: any;
} = {
    USER_ID: '$USER_ID',
};

/**
 * Batch (`*Many`) actions inherit the singular rule when not declared
 * explicitly, so a config can define just `create` / `update` / `delete`.
 * One-directional: the singular is canonical (declaring only the `*Many`
 * variant does not enable the singular). Consumed by the Prisma proxy
 * (`selectPermission`) and the `RbacGuard`.
 */
export const SINGULAR_ACTION: Record<string, string> = {
    createMany: 'create',
    updateMany: 'update',
    deleteMany: 'delete',
};

/** Detect delegate keys on an arbitrary Prisma client type C */
type DelegateKeyOf<C> = {
    [K in keyof C]:
    C[K] extends {findMany: (...args: any[]) => any} ? K : never
}[keyof C] & string;

/** Client-specific lowercase delegate key union */
type ClientDelegateKey<C> = DelegateKeyOf<C>;

/** Accept case-insensitive model keys for a given client C */
type ModelKey<C extends RuntimeClient = RuntimeClient> =
    ClientDelegateKey<C> | Capitalize<ClientDelegateKey<C>>;

/** Normalize to the exact lowercase delegate key of C (provably keyof C) */
type NormalizeModel<
    C extends RuntimeClient,
    M extends ModelKey<C>
> =
    M extends ClientDelegateKey<C> ? M
        : M extends Capitalize<ClientDelegateKey<C>> ? Uncapitalize<M> & ClientDelegateKey<C>
            : never;

/** The delegate instance for a model on client C */
type DelegateFor<
    C extends RuntimeClient,
    M extends ModelKey<C>
> = C[NormalizeModel<C, M>];

/** Only callable keys on that delegate */
type MethodKeys<
    C extends RuntimeClient,
    M extends ModelKey<C>
> = {
    [K in keyof DelegateFor<C, M>]:
    DelegateFor<C, M>[K] extends (...args: any[]) => any ? K : never
}[keyof DelegateFor<C, M>] & string;

/** Restrict to Prisma operations that Prisma.Args understands */
type OperationKeys<
    C extends RuntimeClient,
    M extends ModelKey<C>
> = Extract<MethodKeys<C, M>, Operation>;

/** Canonical args via Prisma helper (now K is guaranteed to be Prisma.Operation) */
type ArgsOf<
    C extends RuntimeClient,
    M extends ModelKey<C>,
    K extends OperationKeys<C, M>
> = Prisma.Args<DelegateFor<C, M>, K>;

/** Extract the method's `where` type from canonical args */
type WhereOf<
    C extends RuntimeClient,
    M extends ModelKey<C>,
    K extends OperationKeys<C, M>
> =
    ArgsOf<C, M, K> extends {where?: infer W} ? W :
        ArgsOf<C, M, K> extends {where: infer W} ? W :
            never;

/** Keep only operations that actually accept a `where` */
type MethodsWithWhere<
    C extends RuntimeClient,
    M extends ModelKey<C>
> = {
    [K in OperationKeys<C, M>]:
    WhereOf<C, M, K> extends never ? never : K
}[OperationKeys<C, M>] & string;

/** ===== Adapted types (client-aware, method-aware) ===== */

export type FieldConditions<
    M extends ModelKey<RuntimeClient>,
    A extends MethodsWithWhere<RuntimeClient, M>
> = WhereOf<RuntimeClient, M, A>;

export interface ActionPermission<
    M extends ModelKey<RuntimeClient> = ModelKey<RuntimeClient>,
    A extends MethodsWithWhere<RuntimeClient, M> = MethodsWithWhere<RuntimeClient, M>
> {
    conditions: FieldConditions<M, A> | FieldConditions<M, A>[];
    setUserIdField?: string;
    restrictedFields?: string[];
}

export type RolePermissions<
    M extends ModelKey<RuntimeClient> = ModelKey<RuntimeClient>
> =
    {
        [A in MethodsWithWhere<RuntimeClient, M>]?: 'ALL' | ActionPermission<M, A>;
    } & {
    [custom: string]: 'ALL' | {
        conditions?: unknown | unknown[];
        setUserIdField?: string;
        restrictedFields?: string[];
    };
};

export type ModelPermissions<
    M extends ModelKey<RuntimeClient> = ModelKey<RuntimeClient>
> = {
    [role: string]: RolePermissions<M>;
};

export type PermissionsConfigType<
    M extends ModelKey<RuntimeClient> = ModelKey<RuntimeClient>
> = {
    [model in M]?: ModelPermissions<model>;
};
