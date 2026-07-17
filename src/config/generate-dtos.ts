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
 *
 * Nested relation writes (CREATE DTOs only — `updateMany` takes scalar data):
 *   Each relation gets a nested-write member exposing ONLY the operators the
 *   data-access proxy authorizes: `create` (validated against the related
 *   model's writable scalars) and `connect` (validated against the related
 *   model's unique fields). Other operators (`set`/`disconnect`/`update`/…) are
 *   deliberately NOT emitted, so the whitelist pipe rejects them. The proxy
 *   enforces the matching ABAC rule for each (`create` rule / `connect` rule).
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
    isUnique?: boolean;
    isUpdatedAt?: boolean;
    hasDefaultValue: boolean;
    default?: any;
    type: string;
    documentation?: string;
    relationName?: string;
    relationFromFields?: string[];
};

const modelsByName: Record<string, any> = {};
for (const m of Prisma.dmmf.datamodel.models) modelsByName[m.name] = m;

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

function writableFields(model: any, omit: string[] = []): DmmfField[] {
    return (model.fields as DmmfField[]).filter((f) => {
        if (f.kind === 'object') return false; // relation navigation
        if (f.isId) return false;
        if (isServerManagedTimestamp(f)) return false;
        if (isNoWrite(f.documentation)) return false;
        if (omit.includes(f.name)) return false;
        return true;
    });
}

/** id + unique scalar fields (for a connect-by DTO). */
function connectFields(model: any): DmmfField[] {
    return (model.fields as DmmfField[]).filter((f) => f.kind !== 'object' && (f.isId || f.isUnique));
}

/** The scalar FK column(s) the parent sets automatically — omit from a nested create. */
function backFkColumns(relatedModel: any, relationName?: string): string[] {
    const inverse = (relatedModel.fields as DmmfField[]).find(
        (f) => f.kind === 'object' && f.relationName === relationName && (f.relationFromFields || []).length > 0,
    );
    return inverse ? inverse.relationFromFields || [] : [];
}

/** Renders class-body lines for a set of scalar/enum fields; collects imports. */
function renderScalarLines(
    fields: DmmfField[],
    mode: 'create' | 'update' | 'connect',
    validatorImports: Set<string>,
    enumImports: Set<string>,
): string[] {
    const lines: string[] = [];
    for (const field of fields) {
        const m = mapField(field);
        validatorImports.add(m.validator);
        if (m.enumArg) enumImports.add(m.enumArg);

        // update / connect: everything optional. create: optional if not required or defaulted.
        const optional = mode !== 'create' || !field.isRequired || field.hasDefaultValue;
        const isList = field.isList;
        const tsType = isList ? `${m.tsType}[]` : m.tsType;

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
    return lines;
}

function renderClass(className: string, bodyLines: string[]): string {
    return `export class ${className} {\n` + (bodyLines.length ? bodyLines.join('\n') : '') + `}\n`;
}

/**
 * For a model's CREATE DTO, render the nested-write classes for each relation
 * plus the property lines to add to the parent class. Nested create classes are
 * scalars-only (no deeper relations) so there are no circular imports.
 */
function renderRelationNestedWrites(
    model: any,
    validatorImports: Set<string>,
    enumImports: Set<string>,
    transformerImports: Set<string>,
): {classes: string[]; parentLines: string[]} {
    const classes: string[] = [];
    const parentLines: string[] = [];
    const relations = (model.fields as DmmfField[]).filter((f) => f.kind === 'object');

    for (const rel of relations) {
        const related = modelsByName[rel.type];
        if (!related) continue;
        const relCap = rel.name.charAt(0).toUpperCase() + rel.name.slice(1);
        const createCls = `${model.name}${relCap}CreateNestedDto`;
        const connectCls = `${model.name}${relCap}ConnectNestedDto`;
        const writeCls = `${model.name}${relCap}NestedWriteDto`;

        // create: related writable scalars minus the back-reference FK.
        const omit = backFkColumns(related, rel.relationName);
        classes.push(renderClass(createCls, renderScalarLines(writableFields(related, omit), 'create', validatorImports, enumImports)));

        // connect: related unique fields (all optional).
        const conn = connectFields(related);
        classes.push(renderClass(connectCls, renderScalarLines(conn, 'connect', validatorImports, enumImports)));

        // nested-write: create? / connect? only.
        transformerImports.add('Type');
        validatorImports.add('IsOptional');
        validatorImports.add('ValidateNested');
        const eachArg = rel.isList ? '{ each: true }' : '';
        const arrSuffix = rel.isList ? '[]' : '';
        if (rel.isList) validatorImports.add('IsArray');
        const opLines: string[] = [];
        for (const [op, cls] of [['create', createCls], ['connect', connectCls]] as const) {
            if (rel.isList) opLines.push('    @IsArray()');
            opLines.push('    @IsOptional()');
            opLines.push(`    @ValidateNested(${eachArg})`);
            opLines.push(`    @Type(() => ${cls})`);
            opLines.push(`    ${op}?: ${cls}${arrSuffix};`);
            opLines.push('');
        }
        classes.push(renderClass(writeCls, opLines));

        // property on the parent CREATE DTO.
        parentLines.push('    @IsOptional()');
        parentLines.push('    @ValidateNested()');
        parentLines.push(`    @Type(() => ${writeCls})`);
        parentLines.push(`    ${rel.name}?: ${writeCls};`);
        parentLines.push('');
    }
    return {classes, parentLines};
}

/** Renders a base DTO file (nested relation writes on create only). */
function renderBaseDto(className: string, model: any, mode: 'create' | 'update'): string {
    const validatorImports = new Set<string>();
    const enumImports = new Set<string>();
    const transformerImports = new Set<string>();

    const scalarLines = renderScalarLines(writableFields(model), mode, validatorImports, enumImports);

    let nested = {classes: [] as string[], parentLines: [] as string[]};
    if (mode === 'create') {
        nested = renderRelationNestedWrites(model, validatorImports, enumImports, transformerImports);
    }

    const parentClass = renderClass(className, [...scalarLines, ...nested.parentLines]);

    const importLines: string[] = [];
    if (validatorImports.size > 0) {
        importLines.push(`import { ${[...validatorImports].sort().join(', ')} } from 'class-validator';`);
    }
    if (transformerImports.size > 0) {
        importLines.push(`import { ${[...transformerImports].sort().join(', ')} } from 'class-transformer';`);
    }
    if (enumImports.size > 0) {
        importLines.push(`import { ${[...enumImports].sort().join(', ')} } from '@prisma/client';`);
    }

    return (
        GENERATED_BANNER +
        '\n' +
        (importLines.length ? importLines.join('\n') + '\n\n' : '') +
        // nested classes first (referenced by @Type in the parent).
        (nested.classes.length ? nested.classes.join('\n') + '\n' : '') +
        parentClass
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

    for (const mode of ['create', 'update'] as const) {
        const capMode = mode.charAt(0).toUpperCase() + mode.slice(1);
        const baseClass = `${capMode}${modelName}GeneratedDto`;
        const subclass = `${capMode}${modelName}Dto`;

        // Base (overwritten, gitignored).
        const basePath = path.join(generatedDtoRoot, folder, `${mode}-${folder}.generated.dto.ts`);
        writeGeneratedFile(basePath, renderBaseDto(baseClass, model, mode));

        // Subclass (once, hand-owned, committed).
        const subPath = path.join(modulesRoot, folder, 'dto', `${mode}-${folder}.dto.ts`);
        const importPath = `../../../generated/dto/${folder}/${mode}-${folder}.generated.dto`;
        createFileIfNotExists(subPath, renderSubclassDto(subclass, baseClass, importPath));
    }
}

console.log('DTOs generated.');
