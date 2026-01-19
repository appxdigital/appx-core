import {AdminConfigType} from '@appxdigital/appx-core';
import {ComponentLoader} from 'adminjs';

const componentLoader = new ComponentLoader();

export const AdminConfig: AdminConfigType = {
    componentLoader,
    adminRoles: ['ADMIN'],
    resources: [
        {
            name: 'User',
        },
    ],
    rootPath: '/admin',
    branding: {
        companyName: 'AppX Core',
        logo: 'https://appx-website-assets.fra1.cdn.digitaloceanspaces.com/2024/04/logo_color.svg',
    },
    // As you can see below, you can customize the dashboard component, which is the first page you see when you access the AdminJS
    dashboard: {
        component: componentLoader.add(
            'Dashboard',
            '../backoffice/components/dashboard',
        ),
    },
};
