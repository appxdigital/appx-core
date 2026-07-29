export interface UserCreateInput {
    email: string;
    password: string;
    name?: string;
}

/**
 * The type of a user's primary key as accepted at API boundaries. `User.id` is a
 * `String` (uuid/cuid) or an `Int` (autoincrement) depending on the consumer's
 * schema, so anything that *accepts* a user id (route params, service methods,
 * session data) should accept both. Framework code coerces to the concrete type
 * at the data-access boundary via `coerceId`.
 *
 * Note `User.id` below stays `string`: the authenticated principal is treated as
 * an opaque string id throughout auth/session, and widening it here would force
 * casts in consumer override code. Use `UserId` for *inputs*, not the principal.
 */
export type UserId = string | number;

export interface User {
    id: string;
    email: string;
    name?: string;
    role?: string;
    access_token?: string;
    refresh_token?: string;
}
