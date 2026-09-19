# Contributing to Swagger UI Monaco

Thanks for helping improve Swagger UI Monaco. This repository is an independent fork and is not an official Swagger UI support channel. Please open issues and pull requests against [`ariel1safar/swagger-ui-monaco`](https://github.com/ariel1safar/swagger-ui-monaco), targeting the fork's `main` branch.

## Before opening an issue

Search existing issues first. Bug reports should identify the affected package and version, browser or Node.js runtime, OpenAPI version, a minimal reproduction, and the tests or checks already tried. Report suspected security vulnerabilities privately through [GitHub Security Advisories](https://github.com/ariel1safar/swagger-ui-monaco/security/advisories/new).

## Development setup

Monaco development is isolated under `monaco/`. The distribution is built from the pinned `swagger-ui-dist` npm package, not from the Swagger UI source at the repository root.

Requirements:

- Node.js 22.14 or newer
- npm compatible with the lockfile
- Chromium installed through Playwright for browser and package tests

```sh
cd monaco
npm ci
npx playwright install --with-deps chromium
npm run build
```

Keep patches focused. Do not edit generated `dist/` files or the lockfile by hand. Change `monaco/package-lock.json` only when a dependency change requires it.

## Tests

Behavior changes need a deterministic regression test that fails before the change. Run the checks relevant to the patch; before requesting review, run the complete workspace suite:

```sh
cd monaco
npm run build
npm test
npm run typecheck
npm run lint
npm run test:packages
```

`npm run test:packages` builds package tarballs, installs them in an isolated consumer, verifies exports and declarations, serves installed assets, and runs the browser suite against the installed packages. Release preparation may set `PACKAGE_OUTPUT_DIR` to preserve the tested tarballs and their release manifest; ordinary local runs use temporary output.

In the pull request, list the exact commands run and any checks that were not run. Do not rely on timing delays in tests.

## Updating pinned upstream dependencies

Swagger UI and Monaco Editor are deliberate pins. When updating either one:

1. Change the exact version in `monaco/package.json` with npm so the lockfile changes consistently.
2. Confirm the generated distribution is still built from the npm dependency rather than the repository-root Swagger UI source.
3. Review upstream release notes, license notices, package exports, and integration points.
4. Update the package documentation, compatibility guide, and notices when behavior or attribution changes.
5. Run the full workspace suite, including package and browser tests.

Changes to public interfaces, package formats, release workflows, or dependency choices should be discussed in an issue before implementation.

## Pull requests

Open pull requests against the fork's `main` branch. Describe the user-visible behavior, link the issue when one exists, identify breaking changes explicitly, and include the exact verification commands. Keep upstream source and history intact unless the change specifically requires modifying the inherited Swagger UI code.

Contributions are provided under the repository's [Apache License 2.0](LICENSE).
