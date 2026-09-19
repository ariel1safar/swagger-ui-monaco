# Releasing Swagger UI Monaco

This guide is for maintainers. The first preview, `0.1.0-beta.1`, has not been published. All account creation, identity verification, authentication, package bootstrap, and trusted-publisher configuration below are future human actions; repository automation must never invent or store credentials.

The three packages are released together in dependency order:

1. `swagger-ui-monaco`
2. `swagger-ui-monaco-dist`
3. `swagger-ui-monaco-express`

Preview versions use the npm `next` tag. The first stable `0.1.0` release will use `latest` only after all three preview packages pass a clean registry-install smoke test.

## Human npm account preparation

Before the first publication, the package owner must:

1. [Create an npm account](https://www.npmjs.com/signup) using an address they control and verify the email address.
2. [Enable two-factor authentication](https://docs.npmjs.com/configuring-two-factor-authentication/) for account access and package changes.
3. Download the recovery codes once, store them in an offline password manager or another secure recovery location, and confirm that the account recovery details are current.
4. Authenticate interactively on the release machine. Do not put a password, one-time code, recovery code, granular token, or automation token in this repository, a command example, a GitHub secret, or a log.

Use only the TLS registry endpoint:

```sh
unset NODE_TLS_REJECT_UNAUTHORIZED NPM_CONFIG_STRICT_SSL
npm config set strict-ssl true
npm config get strict-ssl
npm config get registry
npm login --registry=https://registry.npmjs.org/ --auth-type=web
npm whoami --registry=https://registry.npmjs.org/
npm ping --registry=https://registry.npmjs.org/
```

`npm config get strict-ssl` must print `true`, and `npm config get registry` must print `https://registry.npmjs.org/`. Stop if TLS verification is disabled, the registry uses an `http://` URL, or an unexpected registry is configured. The remaining commands must complete for the intended owner account before publishing.

## Synchronize the package version

All four manifests and the lockfile must use the same release version. From `monaco/`, update the workspace root and all packages together, then set the Express package's exact internal distribution dependency and regenerate lockfile metadata. For the first preview:

```sh
cd monaco
npm version 0.1.0-beta.1 --workspaces --include-workspace-root --no-git-tag-version
npm pkg set dependencies.swagger-ui-monaco-dist=0.1.0-beta.1 --workspace packages/express
npm install --package-lock-only
```

Review `package.json`, all three `packages/*/package.json` files, and `package-lock.json`. Do not hand-edit the lockfile. Update the compatibility guide and changelog for dependency or behavior changes before opening the release pull request.

If the manifests already contain the intended version, do not rerun `npm version`; verify the existing values and continue.

## Prepare and verify release artifacts

Start from the reviewed release commit on `main`. The working tree must be clean, the commit must be contained in `origin/main`, all four manifests must use the same version, and the local tag must point to `HEAD`.

For the first preview:

```sh
git switch main
git fetch origin main --tags
git pull --ff-only origin main
git status --short
git tag -a monaco-v0.1.0-beta.1 -m "Swagger UI Monaco 0.1.0-beta.1"

cd monaco
npm --version
npm ci
npx playwright install --with-deps chromium
npm run build
npm test
npm run typecheck
npm run lint
PACKAGE_OUTPUT_DIR=.work/release/0.1.0-beta.1 npm run test:packages
npm run release:verify -- 0.1.0-beta.1
npm run release:publish -- .work/release/0.1.0-beta.1 --dry-run
```

An empty result from `git status --short` is required before tagging. npm 11.5.1 or newer is required; if `npm --version` reports an older version, update npm before continuing. If a `monaco-v0.1.0-beta.1` tag already exists, verify that it points to the intended commit rather than moving or replacing it.

`npm run test:packages` includes the browser suite and writes the three tested tarballs and `release-manifest.json` to `.work/release/0.1.0-beta.1` only after every package and browser check passes. A failed check must not leave a release manifest that can be published. `release:verify` validates package metadata, dependency versions, the `monaco-v0.1.0-beta.1` tag, `HEAD`, and ancestry from `origin/main`. The publish dry run validates the saved files without rebuilding or contacting the registry.

Treat the output directory as immutable. Do not rerun `npm pack`, rebuild a tarball, edit the manifest, or replace a file after verification. Publication and recovery must use those exact tested bytes.

## Bootstrap the package names manually

Trusted publishing can be configured only after each package exists on npm. The owner must perform the first publication interactively from the verified output directory. Confirm that the unscoped names are still available and that the logged-in account is intended to own them, then publish in dependency order:

```sh
npm publish .work/release/0.1.0-beta.1/swagger-ui-monaco-0.1.0-beta.1.tgz --access public --tag next --registry=https://registry.npmjs.org/
npm publish .work/release/0.1.0-beta.1/swagger-ui-monaco-dist-0.1.0-beta.1.tgz --access public --tag next --registry=https://registry.npmjs.org/
npm publish .work/release/0.1.0-beta.1/swagger-ui-monaco-express-0.1.0-beta.1.tgz --access public --tag next --registry=https://registry.npmjs.org/
```

These commands publish existing tested tarballs. Do not run `npm publish` from a package source directory. If any command fails, preserve `.work/release/0.1.0-beta.1` and follow the recovery procedure below.

After all three packages are present and verified on npm, push the immutable tag:

```sh
git push origin monaco-v0.1.0-beta.1
```

## Configure npm trusted publishing

After the manual bootstrap, configure a [trusted publisher](https://docs.npmjs.com/trusted-publishers/) separately for each package on npmjs.com with this exact GitHub Actions identity:

| Setting | Value |
| --- | --- |
| Organization or user | `ariel1safar` |
| Repository | `swagger-ui-monaco` |
| Workflow filename | `monaco-release.yml` |
| Environment | Leave blank unless the workflow is deliberately changed to use one |

Allow direct `npm publish` from that workflow. The root `.github/workflows/monaco-release.yml` workflow uses a GitHub-hosted runner, Node.js 24, npm 11.5.1 or newer, and OpenID Connect. It needs only `contents: read` and `id-token: write`. Do not add an npm token GitHub secret; a token would bypass the intended trusted-publisher identity.

## Automated preview releases

For later previews, prepare and verify the version as above, create the matching `monaco-v<version>` tag on a commit contained in `main`, and push the tag. Manually dispatch the root **Monaco release** workflow for that exact tag and version. The workflow rejects a mismatched version, tag, commit, or `main` ancestry before publication.

Dispatch from the tag itself so GitHub's workflow ref, workflow SHA, checked-out commit, and npm provenance all identify the same release source:

```sh
gh workflow run monaco-release.yml --ref monaco-vVERSION -f version=VERSION
```

For example:

```sh
gh workflow run monaco-release.yml --ref monaco-v0.1.0-beta.1 -f version=0.1.0-beta.1
```

The workflow runs the package tests with a preserved output directory, validates the saved release manifest, and calls:

```sh
npm run release:publish -- .work/release/<version>
```

The command validates tarball bytes and embedded package metadata, reads registry state for all packages before changing it, and publishes the existing tested tarballs in plugin, distribution, and Express order. It never rebuilds during publication.

## Registry smoke test and stable release

After publishing a preview, test the registry artifacts in a new empty directory. Do not use the workspace, a local tarball, npm link, or a warm `node_modules` directory.

```sh
mkdir swagger-ui-monaco-registry-smoke
cd swagger-ui-monaco-registry-smoke
npm init -y
npm install swagger-ui-monaco@next swagger-ui-monaco-dist@next swagger-ui-monaco-express@next express
npm ls swagger-ui-monaco swagger-ui-monaco-dist swagger-ui-monaco-express
node -e "const plugin=require('swagger-ui-monaco'); const dist=require('swagger-ui-monaco-dist'); const expressPackage=require('swagger-ui-monaco-express'); if(typeof plugin.createMonacoPlugin!=='function'||typeof dist.getAbsoluteFSPath!=='function'||typeof expressPackage.setup!=='function') process.exit(1)"
```

Also serve the installed Express integration and confirm that the docs page, `swagger-ui-bundle.js`, Monaco runtime, stylesheet, and both workers return successfully in a browser. Record the installed versions and smoke-test result in the stable release pull request.

Only after this passes for all three packages should the stable release pull request:

1. Move the workspace and all package manifests together to `0.1.0` using the synchronized version procedure above.
2. Set `swagger-ui-monaco-express`'s exact `swagger-ui-monaco-dist` dependency to `0.1.0` and regenerate the lockfile.
3. Change user-facing install examples from `@next` to the default install form and remove pending-preview wording.
4. Move the changelog entry from upcoming `0.1.0-beta.1` to released `0.1.0`, preserving the preview history if it remains useful.
5. Run the full verification and registry dry run for `.work/release/0.1.0`.

After that pull request is reviewed and merged, create `monaco-v0.1.0` on the reviewed `main` commit and dispatch the matching release workflow. Stable `0.1.0` publishes under `latest`.

## Failure and recovery

The workflow's prepare job uploads `monaco/.work/release/<version>` as `monaco-release-<version>` with 30-day retention before the OIDC publish job starts. A later publication failure therefore preserves the artifact. Keep it; it contains the only approved tarball bytes for the release attempt.

To recover locally, download the failed run's artifact without modifying it, authenticate as needed, and run:

```sh
cd monaco
npm run release:publish -- .work/release/0.1.0-beta.1 --dry-run
npm run release:publish -- .work/release/0.1.0-beta.1
```

The publisher checks the registry before any publish. It skips a package version only when the registry integrity exactly matches `release-manifest.json`; it then continues in dependency order. If an existing version has different integrity, it stops before publishing anything else.

Never overwrite, unpublish, or recreate an existing version to recover a synchronized release. npm versions are immutable release records. If the saved artifact is missing, corrupt, or inconsistent with the registry, prepare a new prerelease version from a reviewed commit and repeat the full process.

## Reference documentation

- [npm trusted publishers](https://docs.npmjs.com/trusted-publishers/)
- [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust/)
- [Configuring two-factor authentication](https://docs.npmjs.com/configuring-two-factor-authentication/)
