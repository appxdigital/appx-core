/**
 * Schema `///` annotations (`@Role(...)`, `@NoWrite`) apply only when written as
 * tags — a tag quoted in backticks is prose and is ignored, by both the runtime
 * proxy and the DTO generator.
 */
import { annotationText } from '../../src/common/utils/schema-annotations.util';
import { isNoWrite } from '../../src/config/generate-dtos';
import { PrismaService } from '../../src/prisma/prisma.service';

const field = (name: string, documentation?: string) => ({
    name, kind: 'scalar', type: 'String', isRequired: false, isList: false, documentation,
});

describe('schema annotations', () => {
    test('annotationText drops backtick-quoted spans', () => {
        expect(annotationText('unlike `role` (`@NoWrite`), editable')).toBe('unlike  (), editable');
        expect(annotationText('@Role(ADMIN) @NoWrite')).toBe('@Role(ADMIN) @NoWrite');
        expect(annotationText(undefined)).toBe('');
    });

    test('runtime proxy: quoted tags are ignored, real tags apply', () => {
        const client: any = {
            _runtimeDataModel: {
                models: {
                    Doc: {
                        fields: [
                            field('id'),
                            field('note', 'Unlike `role` (`@NoWrite`), editable; secrets use `@Role(ADMIN)`'),
                            field('secret', '@Role(ADMIN) @NoWrite'),
                            field('hidden', 'internal — @Role(none)'),
                        ],
                    },
                },
            },
        };
        const svc: any = new PrismaService(client, {} as any);
        expect(svc.fieldConfigs.doc.fieldConfig).toEqual({ secret: ['ADMIN'], hidden: ['none'] });
        expect(svc.fieldConfigs.doc.noWriteFields).toEqual(['secret', 'hidden']);
    });

    test('DTO generator: quoted tags are ignored, real tags apply', () => {
        expect(isNoWrite('Unlike `role` (`@NoWrite`), editable')).toBe(false);
        expect(isNoWrite('mentions `@Role(none)` only')).toBe(false);
        expect(isNoWrite('@NoWrite')).toBe(true);
        expect(isNoWrite('set by admins @NoWrite')).toBe(true);
        expect(isNoWrite('@Role(none)')).toBe(true);
        expect(isNoWrite(undefined)).toBe(false);
    });
});
