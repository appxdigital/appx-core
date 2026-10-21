/**
 * Boot the scaffold-app fixture with the AdminJS backoffice
 * (`@appxdigital/appx-core-admin`, built at admin/dist), in plain Node.
 *
 * AdminJS is pure ESM and can't be loaded inside jest's VM, so
 * test/admin/*.spec.ts spawns this script (cwd = the fixture dir) and talks to
 * it over HTTP. The admin module is added to the fixture's AppModule as a
 * project's app.module.ts does: `AppxCoreAdminModule.forRoot(AdminConfig,
 * PermissionsConfig)`, with the scaffold main.ts middleware (session, passport,
 * setupCoreSecurity).
 *
 * Prints `ADMIN_READY <port>` once listening.
 */
require('reflect-metadata');
const path = require('path');
const {register} = require('module');
const {pathToFileURL} = require('url');
const {NestFactory} = require('@nestjs/core');
const {Module} = require('@nestjs/common');

const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'scaffold-app');
register(pathToFileURL(path.join(__dirname, 'admin-prisma-hook.mjs')), {
    data: {client: pathToFileURL(path.join(FIXTURE_DIR, 'node_modules', '@prisma', 'client', 'index.js')).href},
});
const {AppModule} = require(path.join(FIXTURE_DIR, 'dist', 'app.module.js'));
const {PermissionsConfig} = require(path.join(FIXTURE_DIR, 'dist', 'config', 'permissions.config.js'));
const core = require(path.join(FIXTURE_DIR, 'node_modules', '@appxdigital', 'appx-core'));
const {AppxCoreAdminModule} = require(path.join(__dirname, '..', '..', 'admin', 'dist'));
const session = require('express-session');
const passport = require('passport');

(async () => {
    const {ComponentLoader} = await import('adminjs');
    const AdminConfig = {
        componentLoader: new ComponentLoader(),
        adminRoles: ['ADMIN'],
        resources: [{name: 'User'}, {name: 'Tenant'}, {name: 'Project'}, {name: 'ProjectMember'}, {name: 'Task'}, {name: 'Comment'}],
        rootPath: '/admin',
        branding: {companyName: 'AppX Core'},
    };
    class AdminApp {}
    Module({imports: [AppModule, AppxCoreAdminModule.forRoot(AdminConfig, PermissionsConfig)]})(AdminApp);
    const app = await NestFactory.create(AdminApp, {logger: false});
    // The scaffold's main.ts middleware: the backoffice shares the app session.
    app.use(
        session(
            core.buildCoreSessionOptions({
                secret: process.env.SESSION_SECRET,
                cookieName: process.env.SESSION_COOKIE_NAME,
                ttlSeconds: 86400,
                store: new core.CorePrismaSessionStore(app.get(core.PrismaService), {ttl: 86400}),
            }),
        ),
    );
    app.use(passport.initialize());
    app.use(passport.session());
    core.setupCoreSecurity(app, {cors: {origin: 'http://localhost:3000', credentials: true}});
    await app.listen(0, '127.0.0.1');
    console.log(`ADMIN_READY ${app.getHttpServer().address().port}`);
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
