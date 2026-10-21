import * as fs from 'fs';
import * as path from 'path';

/**
 * The backoffice (admin/) must not require the ESM-only AdminJS packages at
 * module load time — they are resolved lazily inside the async
 * `createAdminJsModule` via `dynamicImport`. An eager `require` breaks any
 * CommonJS test runner and Node < 20.19 consumers the moment the package is
 * imported.
 *
 * The compiled output is the authority (`npm run build:admin` builds
 * `admin/dist/` before the suite runs): a top-level value import of `adminjs` compiles to
 * `require("adminjs")` in the emitted CJS, so its absence proves the imports
 * are type-only or dynamic.
 */
describe('backoffice AdminJS ESM loading', () => {
    const distFile = path.resolve(
        __dirname,
        '../../admin/dist/appx-core-admin.module.js',
    );

    test('compiled admin module has no eager require of ESM-only packages', () => {
        const compiled = fs.readFileSync(distFile, 'utf8');
        expect(compiled).not.toMatch(/require\("adminjs"\)/);
        expect(compiled).not.toMatch(/require\("@adminjs\/prisma/);
    });
});
