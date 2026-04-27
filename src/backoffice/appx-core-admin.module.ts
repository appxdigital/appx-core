import {DynamicModule, Global, Module} from '@nestjs/common';
import {createActions, dynamicImport} from './utils';
import {readFileSync} from 'fs';
import {getDMMF} from '@prisma/sdk';
import {RequestContextMiddleware} from 'nestjs-request-context';
import {BaseRecord} from 'adminjs';
import * as argon2 from 'argon2';
import {PrismaService} from '../prisma/prisma.service';
import {AdminConfigType} from "../common/config/adminConfigType";
import {ILayer} from "express/node_modules/@types/express-serve-static-core";
import {NextFunction, Request, Response} from "express";
import {Property} from "@adminjs/prisma/lib/Property";
import {PermissionsConfigType} from "../common/config/permissionsConfigTypes";

@Global()
@Module({})
export class AppxCoreAdminModule {
    static forRoot(config: AdminConfigType, permissionConfig: PermissionsConfigType): Promise<DynamicModule> {
        return createAdminJsModule(config, permissionConfig);
    }
}

function lowerCase(name: string) {
    return name.substring(0, 1).toLowerCase() + name.substring(1)
}

async function createAdminJsModule(
    adminConfig: AdminConfigType,
    permissionConfig: PermissionsConfigType,
): Promise<DynamicModule> {
    // Set tmp dir to avoid dot ".adminjs" since it is not served by default on Express 5
    process.env.ADMIN_JS_TMP_DIR ??= 'tmp/adminjs';

    // Due to AdminJS only allowing ESM now, we need to use dynamic imports to load the modules, this function can be found within src/backoffice/utils.ts
    const {default: AdminJS} = await dynamicImport('adminjs');
    const {Database, Resource, convertParam} = await dynamicImport('@adminjs/prisma');
    const {AdminModule} = await dynamicImport('@adminjs/nestjs');
    const {default: importExportFeature} = await dynamicImport(
        '@adminjs/import-export',
    );
    const {default: passwordFeature} =
        await dynamicImport('@adminjs/passwords');

    // This gets the models from the Prisma schema, and then creates the AdminJS resources
    const schemaPath = './prisma/schema.prisma';
    const schema = readFileSync(schemaPath, 'utf-8');
    const dmmf = await getDMMF({datamodel: schema});

    const models: {
        model: any;
        options: any;
        features: any[];
    }[] = [];

    for (const resource of adminConfig.resources) {
        const model = dmmf.datamodel.models.find(
            (model) => model.name === resource.name,
        );

        if (!model) continue;

        models.push({
            model: model,
            options: {
                navigation: {
                    name: null,
                    ...(resource.options?.navigation || {}),
                },
                ...resource.options,
            },
            features:
                model.name === 'User'
                    ? [
                        passwordFeature({
                            properties: {
                                encryptedPassword: 'password',
                                password: 'plainPassword',
                            },
                            hash: argon2.hash,
                            componentLoader: adminConfig.componentLoader,
                        }),
                    ]
                    : [],
        });
    }

    AdminJS.registerAdapter({
        Database,
        Resource: class ExtendedResource extends Resource {
            async findOne(id: string) {
                const idProperty = this.properties().find((property: Property) =>
                    property.isId(),
                );
                if (!idProperty) return null;
                const result = await this.manager.findFirst({
                    where: {
                        [idProperty.path()]: convertParam(
                            idProperty,
                            this.model.fields,
                            id,
                        ),
                    },
                });
                if (!result) return null;
                return new BaseRecord(this.prepareReturnValues(result), this as any);
            }

            async update(pk: string, params = {}) {
                const idProperty = this.properties().find((property: Property) =>
                    property.isId(),
                );
                if (!idProperty) return {};
                const preparedParams = this.prepareParams(params);
                await this.manager.updateMany({
                    where: {
                        [idProperty.path()]: convertParam(
                            idProperty,
                            this.model.fields,
                            pk as any,
                        ),
                    },
                    data: preparedParams,
                });
                const result = (await this.manager.findFirst({
                    where: {
                        [idProperty.path()]: convertParam(
                            idProperty,
                            this.model.fields,
                            pk as any,
                        ),
                    },
                }))!;
                return this.prepareReturnValues(result);
            }
        },
    });

    const Module = await AdminModule.createAdminAsync({
        inject: [PrismaService],
        useFactory: async (prisma: PrismaService) => {
            const authenticate = async (email: string, password: string) => {
                return new Promise((resolve) => {
                    prisma.withExposedModels(['User'], async () => {
                        const user = await prisma.user.findFirst(
                            {
                                where: {
                                    email,
                                },
                            },
                            //@ts-ignore
                            {
                                BYPASS_OMISSION: true,
                            },
                        );

                        if (!user) {
                            return resolve(null);
                        }

                        const isPasswordValid = await argon2.verify(
                            user.password!,
                            password,
                        );

                        if (!isPasswordValid) {
                            return resolve(null);
                        }

                        if (!adminConfig.adminRoles.includes(user.role)) {
                            return resolve(null);
                        }

                        return resolve({email: user.email, role: user.role, id: user.id});
                    });
                });
            };

            return {
                adminJsOptions: {
                    rootPath: adminConfig.rootPath,
                    dashboard: adminConfig.dashboard,
                    branding: {
                        withMadeWithLove: false,
                        ...adminConfig.branding,
                    },
                    resources: models.map((m) => {
                        return {
                            // Proxy client with global getter that reads client.model.X
                            resource: {
                                model: m.model,
                                client: new Proxy(prisma, {
                                    get(target, prop) {
                                        return (
                                            (target as any)[prop] ||
                                            (target as any).model[lowerCase(m.model.name)]
                                        );
                                    },
                                }),
                            },
                            options: {
                                ...m.options,
                                actions: createActions(permissionConfig),
                            },
                            features: [
                                ...(m.features || []),
                                importExportFeature({componentLoader: adminConfig.componentLoader}),
                            ],
                        };
                    }),
                    componentLoader: adminConfig.componentLoader,
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
                        //secure: process.env.NODE_ENV === 'production',
                        secure: false,
                    },
                    name: process.env.SESSION_COOKIE_NAME,
                },
            };
        },
    });

    return {
        ...Module,
        module: class AdminJsModule extends Module.module {
            async onModuleInit() {
                if (super.onModuleInit) {
                    await super.onModuleInit();
                }

                const options = this.adminModuleOptions.adminJsOptions;
                const httpAdapter = this.httpAdapterHost.httpAdapter.getInstance();

                // Add to stack, right before admin router
                const adminIdx = httpAdapter.router.stack.findIndex(
                    (l: ILayer) => l.name === 'admin',
                );

                const middleware = new RequestContextMiddleware();

                //httpAdapter.use(options.rootPath, );
                httpAdapter.use(options.rootPath, (req: Request, res: Response, next: NextFunction) => {
                    middleware.use(req, res, () => {
                        // @ts-ignore
                        req.user = req.session?.adminUser;
                        next();
                    });
                });

                const requestContextLayer = httpAdapter.router.stack.splice(
                    httpAdapter.router.stack.length - 1,
                    1,
                )[0];

                httpAdapter.router.stack.splice(adminIdx, 0, requestContextLayer);
            }
        },
    };
}
