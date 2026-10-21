# @appxdigital/appx-core-admin

AdminJS backoffice for [`@appxdigital/appx-core`](https://www.npmjs.com/package/@appxdigital/appx-core). Every record it lists, shows, edits or deletes goes through the core's data-access proxy as the logged-in admin, so the project's `permissions.config.ts` and `@Role` annotations apply.

## Install

```bash
npm install @appxdigital/appx-core-admin
```

## Use

```ts
// src/app.module.ts
import {AppxCoreAdminModule} from '@appxdigital/appx-core-admin';
import {AdminConfig} from './config/admin.config';
import {PermissionsConfig} from './config/permissions.config';

@Module({
    imports: [
        // …
        AppxCoreAdminModule.forRoot(AdminConfig, PermissionsConfig),
    ],
})
export class AppModule {}
```

```ts
// src/config/admin.config.ts
import {AdminConfigType} from '@appxdigital/appx-core-admin';
import {ComponentLoader} from 'adminjs';

const componentLoader = new ComponentLoader();

export const AdminConfig: AdminConfigType = {
    componentLoader,
    adminRoles: ['ADMIN'],
    resources: [{name: 'User'}],
    rootPath: '/admin',
    branding: {companyName: 'My App'},
};
```

The panel is served at `rootPath`. Only users whose `role` is in `adminRoles` can log in; they sign in with their app email and password and share the app session (`main.ts` session middleware).
