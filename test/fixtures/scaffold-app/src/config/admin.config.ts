import { AdminConfigType } from '@appxdigital/appx-core';
import { ComponentLoader } from 'adminjs';

const componentLoader = new ComponentLoader();

export const AdminConfig: AdminConfigType = {
  componentLoader,
  adminRoles: ['ADMIN'],
  resources: [
    // Mirrors the prisma schema's domain models. Used by the planned
    // AdminJS test suite (test/admin/*) to assert that field-level
    // @Role annotations and per-role action restrictions are translated
    // into the AdminJS resource config (field visibility, edit/delete
    // enable). See ROADMAP.md §2.
    { name: 'User' },
    { name: 'Tenant' },
    { name: 'Project' },
    { name: 'ProjectMember' },
    { name: 'Task' },
    { name: 'Comment' },
  ],
  rootPath: '/admin',
  branding: {
    companyName: 'AppX Core',
    logo: 'https://appx-website-assets.fra1.cdn.digitaloceanspaces.com/2024/04/logo_color.svg',
  },
  // As you can see below, you can customize the dashboard component, which is the first page you see when you access the AdminJS
  dashboard: {
    component: componentLoader.add('Dashboard', '../backoffice/components/dashboard'),
  },
};
