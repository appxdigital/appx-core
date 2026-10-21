/**
 * The AdminJS backoffice is its own package (`@appxdigital/appx-core-admin`,
 * admin/). The library neither exports it nor depends on AdminJS.
 */
import * as path from 'path';
import { FIXTURE_DIR } from '../helpers/fixture-app';

describe('AdminJS is not part of @appxdigital/appx-core', () => {
    test('the library does not export the backoffice', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const core = require(path.join(FIXTURE_DIR, 'node_modules', '@appxdigital', 'appx-core'));
        expect(core.AppxCoreAdminModule).toBeUndefined();
    });

    test('the library declares no AdminJS package', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require('../../package.json');
        const declared = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
        expect(declared.filter((name) => /adminjs/.test(name))).toEqual([]);
    });
});
