import * as path from 'path';
import {
    GENERATED_BANNER,
    IGNORE_FOLDERS,
    createFileIfNotExists,
    pascalToKebabCase,
    writeGeneratedFile,
} from './utils';

/**
 * DTO generator.
 *
 * Generated CRUD controllers type `@Body()` as a generic, so NestJS's
 * ValidationPipe has no concrete class to validate against and unknown fields
 * are accepted. This generator emits a class-validator DTO per model+action so
 * the controller can type its body concretely.
 *
 * Two-file, schema-is-source-of-truth model:
 *   - `src/generated/dto/<model>/create-<model>.generated.dto.ts` — the base
 *     class, derived from the Prisma schema, ALWAYS overwritten (gitignored).
 *   - `src/modules/<model>/dto/create-<model>.dto.ts` — a hand-owned subclass,
 *     generated ONCE, where the developer adds custom validation. Never
 *     overwritten. The controller imports this subclass.
 *
 * A scalar field is writable (appears in the DTO) unless it is:
 *   - the primary key (`@id`),
 *   - a server-managed timestamp (`@default(now())` or `@updatedAt`),
 *   - annotated `/// @NoWrite`, or
 *   - annotated `/// @Role(none)` (readable by nobody ⇒ not CRUD-writable).
 * Relation navigation fields are excluded; their scalar foreign keys are kept.
 */

const cwd = process.cwd();

// Read the consumer's generated Prisma client for the DMMF (authoritative
// field metadata incl. `documentation`, which carries /// @Role / @NoWrite).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {Prisma} = require(path.join(cwd, 'node_modules', '@prisma/client'));

const generatedDtoRoot = path.join(cwd, 'src/generated/dto');
const modulesRoot = path.join(cwd, 'src/modules');

type DmmfField = {
    name: string;
    kind: 'scalar' | 'object' | 'enum' | string;
    isList: boolean;
    isRequired: boolean;
    isId: boolean;
    isUpdatedAt?: boolean;
    hasDefaultValue: boolean;
    default?: any;
    type: string;
    documentation?: string;
};

function isNoWrite(doc?: string): boolean {
    if (!doc) return false;
    if (/@NoWrite\b/i.test(doc)) return true;
    // @Role(none): readable by nobody ⇒ treat as not CRUD-writable.
    const roleMatch = doc.match(/@Role\((.*?)\)/);
    if (roleMatch) {
        const roles = roleMatch[1].split(',').map((r) => r.trim().toLowerCase());
        if (roles.includes('none')) return true;
    }
    return false;
}

function isServerManagedTimestamp(field: DmmfField): boolean {
    if (field.isUpdatedAt) return true;
    const def = field.default;
    return !!def && typeof def === 'object' && def.name === 'now';
}

/** Decision for a scalar/enum field: base validator, TS type, optional enum arg. */
function mapField(field: DmmfField): {validator: string; tsType: string; enumArg?: string} {
    if (field.kind === 'enum') {
        return {validator: 'IsEnum', tsType: field.type, enumArg: field.type};
    }
    switch (field.type) {
        case 'String':
            return {validator: 'IsString', tsType: 'string'};
        case 'Boolean':
            return {validator: 'IsBoolean', tsType: 'boolean'};
        case 'Int':
        case 'BigInt':
            return {validator: 'IsInt', tsType: 'number'};
        case 'Float':
        case 'Decimal':
            return {validator: 'IsNumber', tsType: 'number'};
        case 'DateTime':
            return {validator: 'IsDateString', tsType: 'string'};
        default:
            // Json, Bytes, and anything unrecognised: keep the field (so it isn't
            // stripped by whitelist) without a strict type validator.
            return {validator: 'Allow', tsType: 'any'};
    }
}

function writableFields(model: any): DmmfField[] {
    return (model.fields as DmmfField[]).filter((f) => {
        if (f.kind === 'object') return false; // relation navigation
        if (f.isId) return false;
        if (isServerManagedTimestamp(f)) return false;
        if (isNoWrite(f.documentation)) return false;
        return true;
    });
}

/** Renders a base DTO class body + its import block. */
function renderBaseDto(className: string, fields: DmmfField[], mode: 'create' | 'update'): string {
    const validatorImports = new Set<string>();
    const enumImports = new Set<string>();
    const lines: string[] = [];

    for (const field of fields) {
        const m = mapField(field);
        validatorImports.add(m.validator);
        if (m.enumArg) enumImports.add(m.enumArg);

        // update: everything optional. create: optional if not required or has a default.
        const optional = mode === 'update' || !field.isRequired || field.hasDefaultValue;
        const isList = field.isList;
        const tsType = isList ? `${m.tsType}[]` : m.tsType;

        // Compose the validator decorator. @Allow takes no options; for other
        // validators on a list field, add `{ each: true }` (+ @IsArray).
        let validatorDecorator: string;
        if (m.validator === 'Allow') {
            validatorDecorator = '@Allow()';
        } else {
            const args: string[] = [];
            if (m.enumArg) args.push(m.enumArg);
            if (isList) args.push('{ each: true }');
            validatorDecorator = `@${m.validator}(${args.join(', ')})`;
        }

        const decoratorLines: string[] = [];
        if (optional) {
            validatorImports.add('IsOptional');
            decoratorLines.push('    @IsOptional()');
        }
        if (isList && m.validator !== 'Allow') {
            validatorImports.add('IsArray');
            decoratorLines.push('    @IsArray()');
        }
        decoratorLines.push(`    ${validatorDecorator}`);

        lines.push(decoratorLines.join('\n'));
        lines.push(`    ${field.name}${optional ? '?' : '!'}: ${tsType};`);
        lines.push('');
    }

    const importLines: string[] = [];
    if (validatorImports.size > 0) {
        importLines.push(`import { ${[...validatorImports].sort().join(', ')} } from 'class-validator';`);
    }
    if (enumImports.size > 0) {
        importLines.push(`import { ${[...enumImports].sort().join(', ')} } from '@prisma/client';`);
    }

    return (
        GENERATED_BANNER +
        '\n' +
        (importLines.length ? importLines.join('\n') + '\n\n' : '') +
        `export class ${className} {\n` +
        (lines.length ? lines.map((l) => l).join('\n') : '') +
        `}\n`
    );
}

/** Renders the hand-owned subclass (generated once, then customizable). */
function renderSubclassDto(subclass: string, baseClass: string, importPath: string): string {
    return (
        `import { ${baseClass} } from '${importPath}';\n\n` +
        `/**\n` +
        ` * Hand-owned DTO for the CRUD endpoint. Add custom class-validator rules\n` +
        ` * here; this file is generated once and never overwritten by \`appx generate\`.\n` +
        ` * The base class is regenerated from the Prisma schema.\n` +
        ` */\n` +
        `export class ${subclass} extends ${baseClass} {}\n`
    );
}

for (const model of Prisma.dmmf.datamodel.models) {
    const modelName: string = model.name; // Pascal, e.g. ProjectMember
    const folder = pascalToKebabCase(modelName); // kebab, e.g. project-member
    if (IGNORE_FOLDERS.includes(folder)) continue;

    const fields = writableFields(model);

    for (const mode of ['create', 'update'] as const) {
        const capMode = mode.charAt(0).toUpperCase() + mode.slice(1);
        const baseClass = `${capMode}${modelName}GeneratedDto`;
        const subclass = `${capMode}${modelName}Dto`;

        // Base (overwritten, gitignored).
        const basePath = path.join(generatedDtoRoot, folder, `${mode}-${folder}.generated.dto.ts`);
        writeGeneratedFile(basePath, renderBaseDto(baseClass, fields, mode));

        // Subclass (once, hand-owned, committed).
        const subPath = path.join(modulesRoot, folder, 'dto', `${mode}-${folder}.dto.ts`);
        const importPath = `../../../generated/dto/${folder}/${mode}-${folder}.generated.dto`;
        createFileIfNotExists(subPath, renderSubclassDto(subclass, baseClass, importPath));
    }
}

console.log('DTOs generated.');
