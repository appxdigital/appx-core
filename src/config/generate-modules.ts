import * as fs from 'fs';
import * as path from 'path';
import {createFileIfNotExists, modelFolder} from './utils';

const modulesOutputPath = path.join(process.cwd(), 'src/modules');
const appModulePath = path.join(process.cwd(), 'src/app.module.ts');

/**
 * Generic module template for a given model
 * @param model
 * @param folder
 */
const moduleTemplate = (model: string, folder: string) => `
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ${model}Controller } from './${folder}.controller';
import { ${model}Service } from './${folder}.service';
import { ${model}Resolver } from './${folder}.resolver';

@Module({
  imports: [PrismaModule],
  controllers: [${model}Controller],
  providers: [${model}Service, ${model}Resolver],
})
export class ${model}Module {}
`;

/** Scaffold the module file for a single model (once; never overwritten). */
export function scaffoldModule(modelName: string): void {
    const folder = modelFolder(modelName);
    const modulePath = path.join(modulesOutputPath, folder, `${folder}.module.ts`);
    createFileIfNotExists(modulePath, moduleTemplate(modelName, folder));
}

/**
 * Given the index of an opening `[`, return the index of its matching `]`,
 * counting bracket depth while skipping string literals and comments so that
 * neither a nested array literal (`ThrottlerModule.forRoot([{ ttl }])`) nor a
 * bracket inside a string/comment throws off the match.
 */
function matchingBracket(src: string, openIdx: number): number {
    let depth = 0;
    let inString: string | null = null;
    let inLineComment = false;
    let inBlockComment = false;
    for (let i = openIdx; i < src.length; i++) {
        const c = src[i];
        const next = src[i + 1];
        if (inLineComment) {
            if (c === '\n') inLineComment = false;
            continue;
        }
        if (inBlockComment) {
            if (c === '*' && next === '/') { inBlockComment = false; i++; }
            continue;
        }
        if (inString) {
            if (c === '\\') { i++; continue; } // skip escaped char
            if (c === inString) inString = null;
            continue;
        }
        if (c === '/' && next === '/') { inLineComment = true; i++; continue; }
        if (c === '/' && next === '*') { inBlockComment = true; i++; continue; }
        if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
        if (c === '[') depth++;
        else if (c === ']') {
            depth--;
            if (depth === 0) return i;
        }
    }
    throw new Error('app.module.ts: unbalanced `imports` array (no matching `]`)');
}

/**
 * Pure source transform: register the given models' modules in app.module.ts
 * source. Returns the new source and the module names actually added. Extracted
 * from filesystem I/O so it is unit-testable.
 *
 * Correctness requirements this satisfies:
 *   - **Registration order is preserved.** New modules are appended at the END of
 *     the `@Module` `imports` array, after the existing entries.
 *   - **Nested array literals are respected.** The array's closing `]` is found
 *     by bracket-matching (skipping strings/comments), so a nested
 *     `ThrottlerModule.forRoot([...])` never captures the insertion point.
 *   - **No double registration.** A module already present as an entry in the
 *     imports array is not added again.
 *   - **No double import.** An `import { XModule } …` line is added only if one
 *     isn't already present.
 */
export function addModulesToAppModuleSource(
    content: string,
    modelNames: string[],
): {content: string; added: string[]} {
    // Locate the @Module imports array and its true bounds.
    const moduleIdx = content.indexOf('@Module(');
    if (moduleIdx === -1) throw new Error('app.module.ts: @Module decorator not found');
    const importsKeyIdx = content.indexOf('imports:', moduleIdx);
    if (importsKeyIdx === -1) throw new Error('app.module.ts: `imports:` not found in @Module');
    const openIdx = content.indexOf('[', importsKeyIdx);
    if (openIdx === -1) throw new Error('app.module.ts: `imports` is not an array literal');
    const closeIdx = matchingBracket(content, openIdx);
    const inner = content.slice(openIdx + 1, closeIdx);

    // Modules already registered in the imports array (any `XxxModule` token).
    const registered = new Set<string>((inner.match(/\b\w+Module\b/g) ?? []));
    // Modules already imported (by `import { XModule } from './modules/…'`).
    const imported = new Set<string>();
    const importRegex = /import\s*{\s*(\w+Module)\s*}\s*from\s*'\.\/modules\/[\w-]+\/[\w-]+\.module'/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(content)) !== null) imported.add(match[1]);

    const added: string[] = [];
    const newImports: string[] = [];
    for (const modelName of modelNames) {
        const moduleName = `${modelName}Module`;
        if (registered.has(moduleName)) continue; // already in the imports array
        added.push(moduleName);
        if (!imported.has(moduleName)) {
            const folder = modelFolder(modelName);
            newImports.push(`import { ${moduleName} } from './modules/${folder}/${folder}.module';`);
        }
    }
    if (added.length === 0) return {content, added};

    // Append after the last existing entry, before the array's closing `]`
    // (preserving order and the existing trailing whitespace / indentation).
    let lastContentIdx = closeIdx - 1;
    while (lastContentIdx > openIdx && /\s/.test(content[lastContentIdx])) lastContentIdx--;
    const arrayIsEmpty = lastContentIdx === openIdx;
    const list = added.join(', ');
    let withArray: string;
    if (arrayIsEmpty) {
        withArray = content.slice(0, openIdx + 1) + list + content.slice(openIdx + 1);
    } else {
        const insertAt = lastContentIdx + 1;
        const needsComma = content[lastContentIdx] !== ',';
        const insertion = `${needsComma ? ',' : ''} ${list}`;
        withArray = content.slice(0, insertAt) + insertion + content.slice(insertAt);
    }

    const withImports = newImports.length ? newImports.join('\n') + '\n' + withArray : withArray;
    return {content: withImports, added};
}

/**
 * Register the given models' modules in `src/app.module.ts` — the ONE code
 * mutation in the generator, performed only by the module wizard (never by the
 * deploy-safe pass). Idempotent (already-imported modules are skipped) and scoped
 * to the models passed in — it does NOT scan `src/modules`, so it never registers
 * something the caller didn't ask for.
 */
export function registerModulesInAppModule(modelNames: string[]): void {
    if (modelNames.length === 0) return;
    const {content, added} = addModulesToAppModuleSource(fs.readFileSync(appModulePath, 'utf8'), modelNames);
    if (added.length === 0) {
        console.log('No new modules to register in AppModule.');
        return;
    }
    fs.writeFileSync(appModulePath, content);
    console.log(`AppModule updated: registered ${added.join(', ')}.`);
}
