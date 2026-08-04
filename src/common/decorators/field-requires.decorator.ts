import {Extensions} from '@nestjs/graphql';

/**
 * The GraphQL schema-field `extensions` key under which {@link FieldRequires}
 * records the source columns. The generated read resolver reads it back from the
 * schema when deciding which columns to fetch
 * (see `generic.resolver.ts` → `selectReadColumns`).
 */
export const FIELD_REQUIRES_EXTENSION = 'requires';

/**
 * Declare the model columns a custom GraphQL `@ResolveField` reads from its
 * `@Parent()`, so the generated `find` / `get` fetches those columns even when
 * the client didn't select them.
 *
 * Use it on a computed field whose value derives from a column — e.g. a signed
 * `coverUrl` built from a stored `coverKey`. Without it, only the columns the
 * client selected are fetched and `@Parent().coverKey` would be `undefined`.
 *
 * - Declared → only the listed columns are fetched for the field.
 * - Not declared → all of the model's scalar columns are fetched.
 * - Not needed for an in-place transform that reuses an existing field's name.
 *
 * ABAC applies: a column the caller's role may not read is omitted at query time,
 * so the resolver sees it as absent — a transform can never surface a
 * `@Role`-restricted value.
 *
 * Accepts a single column, several columns, or an array.
 *
 * @param columns - The scalar column name(s) the resolver reads from its parent.
 *
 * @example
 * ```ts
 * @Resolver(() => Project)
 * export class ProjectFields {
 *   constructor(private readonly urls: UrlSigner) {}
 *
 *   @ResolveField(() => String, { nullable: true })
 *   @FieldRequires('coverKey')
 *   coverUrl(@Parent() p: Project) {
 *     return p.coverKey ? this.urls.sign(p.coverKey) : null;
 *   }
 *
 *   @ResolveField(() => String, { nullable: true })
 *   @FieldRequires(['firstName', 'lastName'])
 *   fullName(@Parent() p: Project) {
 *     return [p.firstName, p.lastName].filter(Boolean).join(' ') || null;
 *   }
 * }
 * ```
 */
export const FieldRequires = (...columns: (string | string[])[]) =>
    Extensions({[FIELD_REQUIRES_EXTENSION]: columns.flat()});
