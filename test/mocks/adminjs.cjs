/**
 * Mock for `adminjs` package, only used to satisfy the framework's eager
 * top-level `require('adminjs')` under jest's CJS VM. Stubs the few symbols
 * referenced as values in src/backoffice/appx-core-admin.module.ts so
 * `dist/index.js` can be require()d. Admin functionality is not exercised in
 * the current HTTP test suite — when those tests land, mock real behaviour
 * here or switch to jest --experimental-vm-modules.
 *
 * See (eager-ESM-import finding).
 */
class BaseRecord {
    constructor(params, resource) {
        this.params = params;
        this.resource = resource;
    }
}
class ValidationError extends Error {}

module.exports = {
    BaseRecord,
    ValidationError,
    default: { /* AdminJS default export not used at import time */ },
};
module.exports.default = module.exports;
