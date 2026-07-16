import * as fs from 'fs';
import * as path from 'path';
import { chosenProvider, startDbContainer } from './helpers/test-db';
import {
    buildFramework,
    ensureFixtureInstalled,
    writeFixtureEnv,
    pushFixturePrisma,
    pushFixtureSchemaTo,
    runFixtureGenerate,
    buildFixtureApp,
} from './helpers/fixture-app';

declare global {
    // eslint-disable-next-line no-var
    var __APPX_DB_STOP: (() => Promise<void>) | undefined;
}

/**
 * Boots one DB container shared by every test in the run, then prepares the
 * scaffold-app fixture (a real consumer project under test/fixtures/scaffold-app/
 * that depends on @appxdigital/appx-core via file:../../..). Its rich schema is
 * pushed to two databases on the container:
 *   - appx_fixture — the booted HTTP app (test/http/*.spec.ts)
 *   - appx_abac    — the isolated Prisma-proxy / ABAC harness (test/prisma-proxy
 *                    .spec.ts + test/abac/*.spec.ts), reusing the fixture client
 *
 * Setup steps: start container → build framework dist/ → ensureFixtureInstalled
 * → write live .env → push fixture schema (to appx_fixture + appx_abac) → run
 * appx-core generate → build the fixture app.
 *
 * Disable fixture setup with APPX_SKIP_FIXTURE=1.
 */
export default async function globalSetup(): Promise<void> {
    const provider = chosenProvider();
    // eslint-disable-next-line no-console
    console.log(`\n[appx-core test] booting ${provider} container…`);

    const { proxyUrl, fixtureUrl, parityRootUrl, abacUrl, parityCreds, stop } = await startDbContainer(provider);
    process.env.DATABASE_URL = proxyUrl;
    process.env.APPX_PROXY_DB_URL = proxyUrl;
    process.env.APPX_FIXTURE_DB_URL = fixtureUrl;
    process.env.APPX_PARITY_DB_URL = parityRootUrl;
    process.env.APPX_ABAC_DB_URL = abacUrl;
    // The cli/create-parity test needs the individual fields to feed into
    // inquirer prompts. Pack them into a single env var (URL doesn't carry
    // dbName cleanly when the password might contain `@` or similar).
    process.env.APPX_PARITY_CREDS = JSON.stringify(parityCreds);

    // (B) — fixture (uses appx_fixture database)
    if (process.env.APPX_SKIP_FIXTURE !== '1') {
        // eslint-disable-next-line no-console
        console.log('[appx-core test] preparing scaffold-app fixture…');
        buildFramework();
        ensureFixtureInstalled();
        writeFixtureEnv(fixtureUrl, provider);

        // Wipe any stale generated artefacts from prior runs so re-running
        // `appx-core generate` against a possibly-changed schema is clean.
        // (Notably: .gitkeep or other accidental files in src/modules/ will
        //  break the generator.)
        const generatedDir = path.join(__dirname, 'fixtures', 'scaffold-app', 'src', 'generated');
        const modulesDir = path.join(__dirname, 'fixtures', 'scaffold-app', 'src', 'modules');
        fs.rmSync(generatedDir, { recursive: true, force: true });
        fs.rmSync(modulesDir, { recursive: true, force: true });
        fs.mkdirSync(modulesDir, { recursive: true });

        // app.module.ts is REWRITTEN by the generator each run; revert to the
        // pristine scaffold template before generating so updateAppModule's
        // regex-based import insertion has a clean starting point.
        let pristineAppModule = fs.readFileSync(
            path.join(__dirname, '..', 'cli', 'scaffold', 'src', 'app.module.ts'),
            'utf8',
        );
        // finding: framework's appx-core-admin.module.ts has a
        // top-level `import {BaseRecord} from 'adminjs'`. BaseRecord is used
        // as a *value* (line ~105) so TS can't elide it — the compiled output
        // does `require('adminjs')` eagerly. AdminJS is pure ESM. This works
        // on Node ≥20.19 (require(esm) enabled by default) but fails inside
        // jest's VM, which doesn't honour that flag. Real fix: convert to
        // dynamic import. Test workaround: strip AppxCoreAdminModule from the
        // fixture's app.module.ts so HTTP tests can boot. Admin behaviour is
        // covered separately in test/backoffice/* once the import bug is fixed.
        // Strip three things atomically:
        //   (a) `AppxCoreAdminModule.forRoot(AdminConfig, PermissionsConfig),`
        //       — the call expression in the imports array (with trailing comma)
        //   (b) destructured `AppxCoreAdminModule` from the @appxdigital/appx-core import
        //   (c) the `import { AdminConfig } from './config/admin.config'` line
        pristineAppModule = pristineAppModule
            .replace(/AppxCoreAdminModule\.forRoot\([^)]*\),?\s*/g, '')
            .replace(/AppxCoreAdminModule\s*,\s*/g, '')
            .replace(/,\s*AppxCoreAdminModule(?=\s*[,}])/g, '')
            .replace(/import\s*\{[^}]*AdminConfig[^}]*\}\s*from\s*['"]\.\/config\/admin\.config['"];?\s*\n?/g, '');
        fs.writeFileSync(
            path.join(__dirname, 'fixtures', 'scaffold-app', 'src', 'app.module.ts'),
            pristineAppModule,
        );

        pushFixturePrisma(provider);
        // Stand up the isolated ABAC matrix DB (appx_abac) with the same rich schema.
        pushFixtureSchemaTo(abacUrl);
        runFixtureGenerate();
        buildFixtureApp();
    }

    global.__APPX_DB_STOP = stop;
}
