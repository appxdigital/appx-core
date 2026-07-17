/**
 * Runs the proxied-delegate TYPE contract as part of the normal test suite
 * (no separate command). Compiles `test/types/*.type-test.ts` with `tsc`; the
 * fixture's `@ts-expect-error` directives mean tsc fails if any invalid call
 * compiles (unused directive) or any valid call breaks — so this asserts the
 * proxied types both accept good calls and reject bad ones.
 */
import { execFileSync } from 'node:child_process';
import * as path from 'path';

describe('proxied Prisma delegate — TypeScript contract', () => {
    const root = path.resolve(__dirname, '..', '..');
    const tsc = path.join('node_modules', 'typescript', 'bin', 'tsc');

    test('compiles and rejects invalid calls (tsc -p tsconfig.typecheck.json)', () => {
        try {
            execFileSync('node', [tsc, '-p', 'tsconfig.typecheck.json'], { cwd: root, stdio: 'pipe' });
        } catch (e: any) {
            const out = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim();
            throw new Error(`Type contract check failed:\n${out}`);
        }
    }, 60_000);
});
