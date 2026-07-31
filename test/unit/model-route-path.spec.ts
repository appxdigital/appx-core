/**
 * `modelRoutePath` — the HTTP route prefix for a generated controller.
 *
 * Kebab-case so the route matches the file names the same generator emits
 * (`album-member.controller.ts` ↔ `/album-members`); previously the prefix was
 * `model.toLowerCase() + 's'`, which ran words together (`albummembers`) and
 * doubled a trailing s (`publishsettingss`).
 *
 * Deliberately NOT a pluralization engine — model names are not necessarily
 * English, so no -ies/-es rules. The only guard is against a doubled 's'.
 */
import { modelRoutePath } from '../../src/config/utils';

describe('modelRoutePath', () => {
    it('kebab-cases multi-word model names', () => {
        expect(modelRoutePath('AlbumMember')).toBe('album-members');
        expect(modelRoutePath('TypeSample')).toBe('type-samples');
        expect(modelRoutePath('UserProfile')).toBe('user-profiles');
    });

    it('does not double a trailing s', () => {
        expect(modelRoutePath('PublishSettings')).toBe('publish-settings');
        expect(modelRoutePath('Settings')).toBe('settings');
    });

    it('handles single-word models', () => {
        expect(modelRoutePath('Tenant')).toBe('tenants');
        expect(modelRoutePath('Tag')).toBe('tags');
    });

    it('applies no English pluralization rules (names may be any language)', () => {
        // 'Category' → 'categorys', NOT 'categories'. Intentional: -ies/-es
        // rules are English-specific and would be wrong for other languages.
        expect(modelRoutePath('Category')).toBe('categorys');
        expect(modelRoutePath('Box')).toBe('boxs');
    });

    it('handles consecutive capitals', () => {
        expect(modelRoutePath('APIKey')).toBe('api-keys');
    });
});
