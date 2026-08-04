import {SetMetadata} from '@nestjs/common';

/**
 * Reflect metadata key under which {@link FieldRequires} records a field
 * resolver's source columns. Read at bootstrap by the GraphQL field-requires
 * scanner (see `field-requires.registry.ts`) to build the model→field→columns
 * registry the read resolver consults.
 */
export const FIELD_REQUIRES_METADATA = 'appx:field_requires';

/**
 * Declare the model columns a custom GraphQL `@ResolveField` reads from its
 * `@Parent()`, so the generated `find` / `get` fetches those columns even when
 * the client didn't select them — at the top level and on nested relations.
 *
 * Use it on a computed field or an in-place transform whose value derives from a
 * column, e.g. a signed `coverUrl` built from a stored `coverKey`. Without it,
 * only the columns the client selected are fetched and `@Parent().coverKey` would
 * be `undefined`.
 *
 * - Declared → only the listed columns are fetched for the field.
 * - Not declared → all of the model's scalar columns are fetched.
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
    SetMetadata(FIELD_REQUIRES_METADATA, columns.flat());
