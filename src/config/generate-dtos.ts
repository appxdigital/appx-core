import * as path from 'path';
import {
    FRAMEWORK_MODELS,
    GENERATED_BANNER,
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
const generatedDtoRoot = path.join(cwd, 'src/generated/dto');
const modulesRoot = path.join(cwd, 'src/modules');

// Populated by generateDtoBases() from the DMMF models it is handed (authoritative
// field metadata incl. `documentation`, which carries /// @Role / @NoWrite).
// A module-level lookup so the relation-nested-write renderer can resolve a
// related model by name without threading it through every call.
let modelsByName: Record<string, any> = {};

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

/** Decision for a scalar/enum field: base validator, TS type, optional enum arg,
 * optional class-transformer `@Type(() => <transform>)` (needed when the wire
 * value must be coerced to a non-primitive before validation, e.g. ISO → Date). */
function mapField(field: DmmfField): {validator: string; tsType: string; enumArg?: string; transform?: string} {
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
            // Prisma types DateTime columns as `Date`; the DTO must match so a
            // controller override (`data: UpdateXDto` vs base `Partial<X>`)
            // type-checks. `@Type(() => Date)` still accepts an ISO string over
            // the wire and coerces it (ValidationPipe runs with transform:true),
            // so there is no API change and Prisma receives a real Date.
            return {validator: 'IsDate', tsType: 'Date', transform: 'Date'};
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
    transformerImports: Set<string>,
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
        if (m.transform) {
            transformerImports.add('Type');
            decoratorLines.push(`    @Type(() => ${m.transform})`);
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
        classes.push(renderClass(createCls, renderScalarLines(writableFields(related, omit), 'create', validatorImports, enumImports, transformerImports)));

        // connect: related unique fields (all optional).
        const conn = connectFields(related);
        classes.push(renderClass(connectCls, renderScalarLines(conn, 'connect', validatorImports, enumImports, transformerImports)));

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

    const scalarLines = renderScalarLines(writableFields(model), mode, validatorImports, enumImports, transformerImports);

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

/**
 * Deploy-safe pass: (re)generate the DTO **base** classes under the gitignored
 * `src/generated/dto/`, one per non-framework model. Overwrite-only — never
 * touches `src/modules/`. `allModels` is the full DMMF list (framework models
 * included) so relation-nested-write members can resolve their target model;
 * bases are only emitted for non-framework models.
 */
export function generateDtoBases(allModels: any[]): void {
    modelsByName = {};
    for (const m of allModels) modelsByName[m.name] = m;

    for (const model of allModels) {
        const modelName: string = model.name; // Pascal, e.g. ProjectMember
        if (FRAMEWORK_MODELS.includes(modelName)) continue;
        const folder = pascalToKebabCase(modelName); // kebab, e.g. project-member

        for (const mode of ['create', 'update'] as const) {
            const capMode = mode.charAt(0).toUpperCase() + mode.slice(1);
            const baseClass = `${capMode}${modelName}GeneratedDto`;
            const basePath = path.join(generatedDtoRoot, folder, `${mode}-${folder}.generated.dto.ts`);
            writeGeneratedFile(basePath, renderBaseDto(baseClass, model, mode));
        }
    }
    console.log('DTO base classes generated.');
}

/**
 * Wizard/scaffold pass: create the hand-owned DTO **subclass** files (create +
 * update) for a single model under `src/modules/<model>/dto/`. Generated once,
 * never overwritten — this is where the developer adds custom validation.
 */
export function scaffoldDtoSubclass(modelName: string): void {
    const folder = pascalToKebabCase(modelName);
    for (const mode of ['create', 'update'] as const) {
        const capMode = mode.charAt(0).toUpperCase() + mode.slice(1);
        const baseClass = `${capMode}${modelName}GeneratedDto`;
        const subclass = `${capMode}${modelName}Dto`;
        const subPath = path.join(modulesRoot, folder, 'dto', `${mode}-${folder}.dto.ts`);
        const importPath = `../../../generated/dto/${folder}/${mode}-${folder}.generated.dto`;
        createFileIfNotExists(subPath, renderSubclassDto(subclass, baseClass, importPath));
    }
}
