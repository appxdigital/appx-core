import {Injectable, OnModuleInit} from '@nestjs/common';
import {DiscoveryService, MetadataScanner} from '@nestjs/core';
import {FIELD_REQUIRES_METADATA} from '../common/decorators/field-requires.decorator';

// NestJS GraphQL reflect keys (set by @Resolver / @ResolveField). Reading them is
// how we recover, for each field resolver, the model it belongs to and the field
// it resolves — including in-place overrides, whose declared columns never reach
// the built schema field.
const RESOLVER_NAME_METADATA = 'graphql:resolver_name';
const RESOLVER_PROPERTY_METADATA = 'graphql:resolve_property';

/**
 * `Model.field` → the columns the field resolver reads, or `null` when the field
 * is a custom resolver that declared nothing (an undeclared resolver means "fetch
 * this model's scalars, we can't know what it reads"). Absence of a key means the
 * field is not a custom resolver at all (a plain column).
 *
 * Populated once at bootstrap by {@link FieldRequiresScanner}; read by the
 * generated read resolver when building the Prisma `select`.
 */
const registry = new Map<string, string[] | null>();

/**
 * Look up a field resolver on a model. Returns `undefined` if the field is not a
 * custom `@ResolveField` (i.e. a plain column), otherwise `{ requires }` where
 * `requires` is the declared columns or `null` if none were declared.
 */
export function getFieldRequires(model: string, field: string): {requires: string[] | null} | undefined {
    const key = `${model}.${field}`;
    if (!registry.has(key)) {
        return undefined;
    }
    return {requires: registry.get(key) ?? null};
}

/**
 * Scans every resolver provider once at startup and records each `@ResolveField`
 * as `Model.field` → its `@FieldRequires` columns. Runs after all providers are
 * instantiated, so field resolvers registered in any feature module are included.
 *
 * This scan (not a per-request read) is required because the code that builds the
 * Prisma query — the generated `find`/`get` — must know the source columns of
 * field resolvers on OTHER classes and nested relation models, not just the
 * executing handler.
 */
@Injectable()
export class FieldRequiresScanner implements OnModuleInit {
    constructor(
        private readonly discovery: DiscoveryService,
        private readonly scanner: MetadataScanner,
    ) {}

    onModuleInit(): void {
        registry.clear();
        for (const wrapper of this.discovery.getProviders()) {
            const instance = wrapper.instance;
            if (!instance || typeof instance !== 'object') {
                continue;
            }
            // The model a resolver is bound to: @Resolver(() => Model) records the
            // model name on the class under RESOLVER_NAME_METADATA.
            const model = Reflect.getMetadata(RESOLVER_NAME_METADATA, instance.constructor);
            if (!model || typeof model !== 'string') {
                continue; // not a model-bound resolver (root resolvers, other providers)
            }
            const prototype = Object.getPrototypeOf(instance);
            if (!prototype) {
                continue;
            }
            for (const methodName of this.scanner.getAllMethodNames(prototype)) {
                const handler = prototype[methodName];
                if (typeof handler !== 'function') {
                    continue;
                }
                if (Reflect.getMetadata(RESOLVER_PROPERTY_METADATA, handler) !== true) {
                    continue; // not a @ResolveField
                }
                const field = Reflect.getMetadata(RESOLVER_NAME_METADATA, handler) || methodName;
                const requires = Reflect.getMetadata(FIELD_REQUIRES_METADATA, handler);
                registry.set(`${model}.${field}`, Array.isArray(requires) ? requires : null);
            }
        }
    }
}
