# Releasing

This repo publishes **two independent packages**, each versioned on its own:

- **`@appxdigital/appx-core`** — the runtime library (root `package.json`),
  released via **`v*`** tags (`release.yml`).
- **`@appxdigital/appx-core-cli`** — the `appx-core` CLI (`cli/package.json`),
  released via **`cli-v*`** tags (`release-cli.yml`).

Both follow the same posture: publishing is deliberate — **it only happens when
you push a git tag** — and production (`latest`) pauses for a human approval
before it goes live.

## Channels

Library (`v*` tags):

| You push tag       | npm dist-tag | Consumers install with            | Gated?          |
| ------------------ | ------------ | --------------------------------- | --------------- |
| `v1.2.3-alpha.N`   | `alpha`      | `…/appx-core@alpha`               | no              |
| `v1.2.3-beta.N`    | `beta`       | `…/appx-core@beta`                | no              |
| `v1.2.3-rc.N`      | `next`       | `…/appx-core@next`                | no              |
| `v1.2.3`           | `latest`     | `…/appx-core` (default)           | **yes** — approval |

CLI (`cli-v*` tags) — identical channels for `@appxdigital/appx-core-cli`:

| You push tag         | npm dist-tag | Consumers install with          | Gated?          |
| -------------------- | ------------ | ------------------------------- | --------------- |
| `cli-v1.2.3-beta.N`  | `beta`       | `…/appx-core-cli@beta`          | no              |
| `cli-v1.2.3`         | `latest`     | `…/appx-core-cli` (default)     | **yes** — approval |

Prereleases are excluded from `^1.2.x` range resolution, so a project on a caret
range never pulls one by accident — testers opt in via the tag or an exact
version. Merging to `main` **never** publishes; it only runs CI (library build +
tests on mysql and postgres, plus a CLI smoke check).

## Two files, two audiences

- **`PRERELEASES.md`** — granular, one entry per alpha/beta build. What a tester
  reads.
- **`CHANGELOG.md`** — collapsed, one section per production release with
  aggregated changes and consolidated migration steps. What an upgrading project
  reads. When you promote a version, distil its prerelease entries into a single
  `CHANGELOG.md` section.

## One-time setup (before the first publish)

1. **npm Trusted Publisher (OIDC) — one per package.** On npmjs.com → the
   package → *Settings* → *Trusted Publisher* → GitHub Actions. Add **two**,
   both owner `appxdigital`, repo `appx-core`:
   - `@appxdigital/appx-core` → workflow `release.yml`
   - `@appxdigital/appx-core-cli` → workflow `release-cli.yml`

   This lets CI mint a short-lived publish token per run — **no `NPM_TOKEN`
   secret is stored anywhere**, and every publish carries supply-chain
   provenance.

2. **GitHub `production` environment (the approval gate).** Repo → *Settings* →
   *Environments* → *New environment* → name it exactly `production` → enable
   *Required reviewers* and add yourself (and/or the team). The
   `publish-production` job targets this environment, so a clean tag will wait
   for a click before publishing to `latest`.

## Cutting a release

The tag must match `package.json`'s version exactly, or the release job fails
fast (a guard against mistagging). Use `npm version` to keep them in lockstep.

### Beta (test in projects first)

```bash
# set the version + create the matching tag + commit, without auto-pushing
npm version 0.1.121-beta.0 --message "release: %s"
git push origin main --follow-tags
```

The `Release` workflow builds, tests, and publishes to the `beta` dist-tag.
Then, in a project you want to test against:

```bash
npm install @appxdigital/appx-core@beta
```

Iterate with `npm version prerelease --preid beta` (→ `-beta.1`, `-beta.2`, …),
each push publishing a new granular `PRERELEASES.md` entry.

### Promote to production (`latest`)

When the beta is validated in real projects:

```bash
# drop the prerelease suffix -> clean version
npm version 0.1.121 --message "release: %s"
git push origin main --follow-tags
```

The workflow builds and tests, then **pauses** on the `production` environment.
Approve it in the repo's *Actions* tab → the running release → *Review
deployments* → *Approve and deploy*. It then publishes to `latest`.

> Alternatively, promotion can be a pure retag without republishing:
> `npm dist-tag add @appxdigital/appx-core@0.1.121-beta.N latest`. The
> tag-driven workflow above is preferred because it re-runs tests and records
> provenance for the exact `latest` artifact.

### Alpha (rough, one or two projects)

```bash
npm version 0.1.122-alpha.0 --message "release: %s"
git push origin main --follow-tags
# in the project:  npm install @appxdigital/appx-core@alpha
```

### CLI (`@appxdigital/appx-core-cli`)

Same flow, but bump `cli/package.json` and use the `cli-v` tag prefix. The tag
must match `cli/package.json`'s version.

```bash
# beta:
npm --prefix cli version 1.0.21-beta.0 --message "release cli: %s"
git commit -am "release cli: 1.0.21-beta.0"   # npm version --prefix does not commit
git tag cli-v1.0.21-beta.0
git push origin main --follow-tags
#   test:  npx @appxdigital/appx-core-cli@beta create …

# production (gated — approve in the Actions tab):
npm --prefix cli version 1.0.21 --message "release cli: %s"
git commit -am "release cli: 1.0.21"
git tag cli-v1.0.21
git push origin main --follow-tags
```

> `npm version --prefix cli` bumps `cli/package.json` but does not create the
> git commit/tag (that only happens when run in the repo root). Commit and tag
> explicitly with the `cli-v` prefix as shown.

## Manual fallback

If CI is unavailable, the historical manual paths still exist
(`npm run npm:publish` at the root for the library, `cd cli && npm run
npm:publish` for the CLI) — but they go straight to `latest` with no gate and no
provenance, so prefer the tag-driven flow.
