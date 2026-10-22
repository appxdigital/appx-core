# Maintaining `@appxdigital/appx-core-admin`

Deprecated and unmaintained. This folder is the source of the published versions, kept in case a patch is ever needed. It builds on its own, against the published `@appxdigital/appx-core`.

To release a patch: change `src/`, bump `version` in `package.json`, add a `CHANGELOG.md` entry, then

```bash
cd admin
npm install
npm run build
npm publish --access public
```
