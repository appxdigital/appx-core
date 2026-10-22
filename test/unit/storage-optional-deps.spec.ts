/**
 * The file-upload storage packages are not dependencies of the package: a
 * project that uses file upload installs them itself, so loading the package must not
 * require them. Runs the compiled `dist/` in plain Node with those modules
 * made unresolvable.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const STORAGE_PACKAGES = [
    '@aws-sdk/client-s3',
    '@aws-sdk/s3-request-presigner',
    '@aws-sdk/types',
    '@google-cloud/storage',
    'multer',
];

describe('file-upload storage packages are not package dependencies', () => {
    test('the package loads without them', () => {
        const script = `
            const Module = require('module');
            const blocked = ${JSON.stringify(STORAGE_PACKAGES)};
            const resolve = Module._resolveFilename;
            Module._resolveFilename = function (request, ...rest) {
                if (blocked.some((p) => request === p || request.startsWith(p + '/'))) {
                    const e = new Error("Cannot find module '" + request + "'");
                    e.code = 'MODULE_NOT_FOUND';
                    throw e;
                }
                return resolve.call(this, request, ...rest);
            };
            const core = require(${JSON.stringify(path.join(ROOT, 'dist', 'index.js'))});
            process.stdout.write(typeof core.AppxCoreModule);
        `;
        expect(execFileSync('node', ['-e', script], { cwd: ROOT, encoding: 'utf8' })).toBe('function');
    });

    test('the build ships every frozen compiled file unchanged', () => {
        const frozen: string[] = [];
        const walk = (dir: string) => {
            for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, e.name);
                if (e.isDirectory()) walk(full);
                else if (e.name.endsWith('.js')) frozen.push(full, full.replace(/\.js$/, '.d.ts'));
            }
        };
        walk(path.join(ROOT, 'src'));
        expect(frozen.length).toBeGreaterThan(0);
        for (const file of frozen) {
            const built = path.join(ROOT, 'dist', path.relative(path.join(ROOT, 'src'), file));
            expect(fs.readFileSync(built, 'utf8')).toBe(fs.readFileSync(file, 'utf8'));
        }
    });

    test('they are not dependencies or peer dependencies', () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pkg = require(path.join(ROOT, 'package.json'));
        for (const name of STORAGE_PACKAGES) {
            expect(pkg.dependencies?.[name]).toBeUndefined();
            expect(pkg.peerDependencies?.[name]).toBeUndefined();
        }
    });
});
