import {SetMetadata} from '@nestjs/common';

export const PERMISSION_METADATA_KEY = 'permission';
export const EXPOSE_MODELS_METADATA_KEY = 'expose_models';

export const Permission = (action: string, expose_models: string[] = []) =>
    SetMetadata(PERMISSION_METADATA_KEY, {action, expose_models});

/**
 * Expose one or more models for the duration of the request — WITHOUT requiring
 * a permission action. Unlike `@Permission(action, models)`, this sets no
 * action, so `RbacGuard` does not demand a role permission for the route. Use it
 * for a public / GUEST endpoint that must read a model the caller isn't
 * otherwise granted (e.g. an email-availability check) without having to add a
 * `GUEST` rule for that model. Exposure is scoped to the request: the listed
 * models skip row / field filtering only inside this handler.
 *
 * Combine with `@Permission(...)` if you also want an action check; both
 * sources of exposed models are merged.
 */
export const ExposeModels = (...models: string[]) =>
    SetMetadata(EXPOSE_MODELS_METADATA_KEY, models);
