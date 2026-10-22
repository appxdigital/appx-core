#!/usr/bin/env node
/**
 * Copy the frozen compiled files (every `.js` under `src/` + its `.d.ts`) into `dist/`
 * at the same paths. tsc only emits from `.ts` sources, so these would
 * otherwise be missing from the package. Runs after `tsc` in `npm run build`.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.resolve('src');
const DIST = path.resolve('dist');

function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full);
        } else if (entry.name.endsWith('.js')) {
            for (const file of [full, full.replace(/\.js$/, '.d.ts')]) {
                const target = path.join(DIST, path.relative(SRC, file));
                fs.mkdirSync(path.dirname(target), {recursive: true});
                fs.copyFileSync(file, target);
            }
        }
    }
}

walk(SRC);
