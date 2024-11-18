export const adminJsModuleCode = `
import {DynamicModule} from '@nestjs/common';
import {addBasicFilters, createActions, createPermissionHandler, dynamicImport, getAdminJSResources} from './utils';
import {initializeComponents} from './component-loader';
import {readFileSync} from 'fs';
import {getDMMF} from '@prisma/sdk';
import {PrismaService} from 'appx_core';
import {PrismaModule} from "../prisma/prisma.module";

const DEFAULT_ADMIN = {
    email: 'joao.duvido@appx.pt',
    password: 'password',
};

const authenticate = async (email: string, password: string) => {
    if (email === DEFAULT_ADMIN.email && password === DEFAULT_ADMIN.password) {
        return Promise.resolve(DEFAULT_ADMIN);
    }
    return null;
};

export async function createAdminJsModule(): Promise<DynamicModule> {
    const {default: AdminJS} = await dynamicImport('adminjs');
    const {Database, Resource} = await dynamicImport('@adminjs/prisma');
    const {AdminModule} = await dynamicImport('@adminjs/nestjs');
    const {default: importExportFeature} = await dynamicImport('@adminjs/import-export');
    const {default: passwordFeature} = await dynamicImport('@adminjs/passwords');
    const argon2 = await dynamicImport('argon2');

    const resources = getAdminJSResources();
    const {componentLoader, Components} = await initializeComponents();
    const schemaPath = './prisma/schema.prisma';
    const schema = readFileSync(schemaPath, 'utf-8');
    const dmmf = await getDMMF({datamodel: schema});

    const models = [];

    for (const resource of resources) {
        const model = dmmf.datamodel.models.find(
            (model) => model.name === resource.name,
        );

        models.push({
            model,
            options: resource.options,
            features: model.name === 'User' ? [
                passwordFeature({
                    properties: {
                        encryptedPassword: 'password',
                        password: 'plainPassword',
                    },
                    hash: argon2.hash,
                    componentLoader,
                }),
            ] : [],
        });
    }

    AdminJS.registerAdapter({Database, Resource});

    return AdminModule.createAdminAsync({
        imports: [PrismaModule],
        inject: [PrismaService],
        useFactory: async (prisma: PrismaService) => {
            const authenticate = async (email: string, password: string) => {
                const user = await prisma.user.findUnique({
                    where: {
                        email
                    }
                });

                if (!user || user.role !== 'ADMIN') {
                    return null;
                }

                const isPasswordValid = await argon2.verify(user.password, password);

                return isPasswordValid ? Promise.resolve({email: user.email, role: user.role, id: user.id}) : null;
            }

            return {
                adminJsOptions: {
                    rootPath: '/admin',
                    dashboard: {
                        component: Components.Dashboard,
                        handler: async () => {
                            return {some: 'output'};
                        },
                    },
                    branding: {
                        companyName: 'AppX Core Wizard',
                        withMadeWithLove: false,
                        logo: 'https://i.ibb.co/XZNRS5m/appxdigitalcom-logo.jpg',
                    },
                    resources: models.map((m) => {
                        return {
                            resource: {model: m.model, client: prisma},
                            options: {
                                ...m.options,
                                actions: createActions(),
                            },
                            features: [...(m.features || []), importExportFeature({
                                componentLoader
                            })],
                        };
                    }),
                    componentLoader,
                },
                auth: {
                    authenticate,
                    cookieName: process.env.SESSION_COOKIE_NAME,
                    cookiePassword: process.env.SESSION_SECRET,
                },
                sessionOptions: {
                    resave: false,
                    saveUninitialized: true,
                    secret: process.env.SESSION_SECRET,
                    cookie: {
                        httpOnly: process.env.NODE_ENV === 'production',
                        secure: false,
                    },
                    name: process.env.SESSION_COOKIE_NAME,
                },
            };
        },
    });
}
`;
