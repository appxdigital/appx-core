import { execSync } from 'child_process';
import * as path from 'path';

/**
 * npm environment for subprocesses that install from the registry.
 * `@appxdigital/appx-core` is on the public npm registry; a machine that maps
 * the `@appxdigital` scope to another registry (e.g. GitHub Packages, for
 * private packages) would otherwise 404 it. Scoped to the child process only.
 */
export const PUBLIC_APPX_SCOPE = { 'npm_config_@appxdigital:registry': 'https://registry.npmjs.org/' };

/**
 * Packs the framework under test into `dest` and returns the tarball path —
 * pass it to `appx-core create` as `APPX_CORE_SPEC` so the created project
 * installs this build rather than the published release.
 */
export function packLocalFramework(dest: string): string {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const tarball = execSync(`npm pack --silent --pack-destination ${dest}`, { cwd: repoRoot, encoding: 'utf8' })
        .trim()
        .split('\n')
        .pop()!;
    return path.join(dest, tarball);
}
