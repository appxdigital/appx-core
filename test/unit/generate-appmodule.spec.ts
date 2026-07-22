/**
 * Regression tests for the module-generator's two reported bugs:
 *
 *  (A) app.module.ts registration was inserted before the first/last `]`, which
 *      landed inside a nested array literal like `ThrottlerModule.forRoot([...])`
 *      — registering modules as throttler options and breaking the build.
 *  (B) "has a module" was a folder-name check, so a hand-written pluralised
 *      module (`wearable-connections/`) serving `WearableConnection` wasn't
 *      recognised and the wizard scaffolded a duplicate singular module.
 */
import { addModulesToAppModuleSource } from '../../src/config/generate-modules';
import { modelsServedBySource } from '../../src/config/utils';

const APP_MODULE_WITH_THROTTLER = `import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppxCoreModule, AuthModule } from '@appxdigital/appx-core';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60, limit: 10 }]),
    AppxCoreModule.forRoot(PermissionsConfig),
    AuthModule.forRoot(),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
`;

describe('addModulesToAppModuleSource — (A) nested-array insertion', () => {
    test('registers modules in the @Module imports array, not inside ThrottlerModule.forRoot([...])', () => {
        const { content, added } = addModulesToAppModuleSource(APP_MODULE_WITH_THROTTLER, ['WearableConnection']);

        expect(added).toEqual(['WearableConnectionModule']);
        // Import statement added.
        expect(content).toMatch(
            /import { WearableConnectionModule } from '\.\/modules\/wearable-connection\/wearable-connection\.module';/,
        );
        // The throttler config array is left completely intact.
        expect(content).toContain('ThrottlerModule.forRoot([{ ttl: 60, limit: 10 }])');
        // It must NOT appear inside the throttler's own bracket pair.
        expect(content).not.toMatch(/ttl: 60, limit: 10 }, WearableConnectionModule/);
        // Bracket balance is preserved (rough proxy for "still compiles").
        expect((content.match(/\[/g) || []).length).toBe((content.match(/\]/g) || []).length);
    });

    test('appends at the END of the imports array, preserving existing registration order', () => {
        const { content } = addModulesToAppModuleSource(APP_MODULE_WITH_THROTTLER, ['Alpha', 'Beta']);
        const start = content.indexOf('imports: [');
        const throttler = content.indexOf('ThrottlerModule.forRoot', start);
        const core = content.indexOf('AppxCoreModule.forRoot', start);
        const auth = content.indexOf('AuthModule.forRoot', start);
        const alpha = content.indexOf('AlphaModule', start);
        const beta = content.indexOf('BetaModule', start);
        // existing order preserved, new modules after all of them, in given order.
        expect(throttler).toBeLessThan(core);
        expect(core).toBeLessThan(auth);
        expect(auth).toBeLessThan(alpha);
        expect(alpha).toBeLessThan(beta);
    });

    test('does not re-register a module already present in the imports array', () => {
        const src = APP_MODULE_WITH_THROTTLER.replace(
            'AuthModule.forRoot(),',
            'AuthModule.forRoot(),\n    WearableConnectionModule,',
        );
        const { content, added } = addModulesToAppModuleSource(src, ['WearableConnection']);
        expect(added).toEqual([]);
        // exactly one occurrence in the imports array.
        expect((content.match(/\bWearableConnectionModule\b/g) || []).length).toBe(1);
    });

    test('does not add a duplicate import line when the module is already imported', () => {
        // Imported but NOT yet in the imports array → registered, no second import.
        const src =
            `import { WearableConnectionModule } from './modules/wearable-connection/wearable-connection.module';\n` +
            APP_MODULE_WITH_THROTTLER;
        const { content, added } = addModulesToAppModuleSource(src, ['WearableConnection']);
        expect(added).toEqual(['WearableConnectionModule']); // added to the array…
        // …but the import line count stays at exactly one.
        expect((content.match(/from '\.\/modules\/wearable-connection\/wearable-connection\.module'/g) || []).length).toBe(1);
    });

    test('is idempotent — running twice adds nothing the second time', () => {
        const once = addModulesToAppModuleSource(APP_MODULE_WITH_THROTTLER, ['WearableConnection']).content;
        const { added } = addModulesToAppModuleSource(once, ['WearableConnection']);
        expect(added).toEqual([]);
    });

    test('handles an empty imports array without a dangling comma issue', () => {
        const empty = `import { Module } from '@nestjs/common';\n@Module({ imports: [], controllers: [], providers: [] })\nexport class AppModule {}\n`;
        const { content } = addModulesToAppModuleSource(empty, ['Habit']);
        expect(content).toMatch(/imports:\s*\[HabitModule\]/);
    });
});

describe('modelsServedBySource — (B) ownership by model, not folder', () => {
    test('detects a model served by a CoreController<Model> under any folder name', () => {
        // A hand-written pluralised module owning the singular model.
        const controller = `export class WearableConnectionsController extends CoreController<WearableConnection> {}`;
        const owned = modelsServedBySource([controller]);
        expect(owned.has('WearableConnection')).toBe(true);
    });

    test('detects a model served by a CoreService<Model>', () => {
        const service = `export class FooService extends CoreService<Widget> {}`;
        expect(modelsServedBySource([service]).has('Widget')).toBe(true);
    });

    test('returns empty when no CoreController/CoreService generics are present', () => {
        expect(modelsServedBySource(['export class Plain {}']).size).toBe(0);
    });
});
