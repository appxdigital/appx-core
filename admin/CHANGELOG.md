# Changelog

All notable changes to `@appxdigital/appx-core-admin` are documented here.

## [0.1.0]

### Added

- **The AdminJS backoffice as its own package**, moved from `@appxdigital/appx-core` unchanged: `AppxCoreAdminModule.forRoot(AdminConfig, PermissionsConfig)` and `AdminConfigType`. Works with `@appxdigital/appx-core` 0.1.132 and later.

### Migration

From the backoffice built into `@appxdigital/appx-core`:

```bash
npm install @appxdigital/appx-core-admin
```

In `src/app.module.ts` and `src/config/admin.config.ts`, import `AppxCoreAdminModule` and `AdminConfigType` from `@appxdigital/appx-core-admin` instead of `@appxdigital/appx-core`. Nothing else changes.
