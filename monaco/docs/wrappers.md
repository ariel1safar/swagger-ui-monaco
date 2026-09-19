# Using existing Swagger UI wrappers

Wrappers such as NestJS can keep generating their OpenAPI document and Swagger UI page while serving this project's Monaco-enabled distribution. Replace the wrapper's `swagger-ui-dist` dependency with `swagger-ui-monaco-dist`, keeping the wrapper's application API.

The `0.1.0-beta.1` preview is not published yet. The registry examples below become usable after publication. They pin the preview explicitly so a later `next` release cannot silently change your override. Node.js 22.14 or newer is required.

## NestJS with a dependency override

Keep your existing `@nestjs/swagger` imports, document generation, and `SwaggerModule.setup(...)` call. Choose one package-manager configuration in the application or monorepo root, then reinstall. These examples assume `swagger-ui-dist` is only a transitive dependency.

### npm

Merge into the root `package.json`:

```json
{
  "overrides": {
    "@nestjs/swagger": {
      "swagger-ui-dist": "npm:swagger-ui-monaco-dist@0.1.0-beta.1"
    }
  }
}
```

Run `npm install` and inspect `npm ls swagger-ui-dist`. npm reads overrides from the project root and supports replacing a dependency with another package. If you also directly depend on `swagger-ui-dist`, its alias spec and override must match, or use npm's `$` dependency-reference syntax; see [npm overrides](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#overrides).

### Yarn

Merge into the root `package.json`:

```json
{
  "resolutions": {
    "@nestjs/swagger/swagger-ui-dist": "npm:swagger-ui-monaco-dist@0.1.0-beta.1"
  }
}
```

Run `yarn install` and inspect `yarn why swagger-ui-dist`. The parent selector limits the replacement to NestJS's dependency; see [Yarn resolutions](https://yarnpkg.com/configuration/manifest#resolutions).

These examples use a `node_modules` installation. For modern Yarn, configure `.yarnrc.yml` with `nodeLinker: node-modules`. Static file serving from Plug'n'Play zip archives has not been verified; see [Yarn's nodeLinker setting](https://yarnpkg.com/configuration/yarnrc#nodeLinker).

### pnpm

Merge into the root `pnpm-workspace.yaml`:

```yaml
overrides:
  "@nestjs/swagger>swagger-ui-dist": "npm:swagger-ui-monaco-dist@0.1.0-beta.1"
```

Run `pnpm install` and inspect `pnpm why swagger-ui-dist`. The `>` selector targets the dependency of the named parent; see [pnpm overrides](https://pnpm.io/settings/dependency-resolution#overrides).

## Verify the installed result

Commit the changed package-manager configuration and lockfile together. Restart the application after installation; do not edit files inside `node_modules`.

Check the asset directory resolved from NestJS's own dependency context:

```sh
node -e "const fromSwagger = require('node:module').createRequire(require.resolve('@nestjs/swagger')); console.log(fromSwagger('swagger-ui-dist/absolute-path.js')());"
```

The returned directory should contain the enhanced `swagger-ui-bundle.js` and the complete `monaco/` asset directory. In the browser's Network panel, check that the served bundle includes the `MODIFIED BY swagger-ui-monaco` comment and that Monaco runtime, stylesheet, and worker requests succeed. Open a JSON request body in **Try it out** and confirm the Monaco editor loads. Check both `/docs` and `/docs/`, or the equivalent nested paths in your application, as relative asset URLs can differ.

Keep the complete distribution together when copying assets into a container or deploying behind a static-file server. See [compatibility and CSP requirements](compatibility.md).

## Compatibility boundaries

The replacement provides the asset-path contract used by NestJS: `getAbsoluteFSPath()`, `absolutePath()`, and the `absolute-path` / `absolute-path.js` helper subpaths, plus the distribution's static assets. NestJS 11.4.7's [asset loader](https://github.com/nestjs/swagger/blob/11.4.7/lib/swagger-ui/swagger-ui.ts) imports `swagger-ui-dist/absolute-path.js`.

The package bundles Swagger UI 5.32.15 and Monaco Editor 0.56.0. Its own `0.1.0-beta.1` version is not an upstream Swagger UI version. An override deliberately bypasses the wrapper's declared distribution version, so recheck compatibility when either package changes. Public-registry installation of this preview cannot be verified until it is published; the package-manager examples are configurations to use after that release.

Local tarball replacements were checked with npm 11.19.0, Yarn Classic 1.22.22, and pnpm 10.18.3 on Node.js 24.20.0. The npm consumer used `@nestjs/swagger` 11.4.7 and NestJS 11.2.5; browser checks covered `/docs`, `/docs/`, `/api/docs`, and `/api/docs/`, including schema completion, edited requests, response viewing, and Monaco assets. Modern Yarn and other wrapper versions have not been smoke-tested.

Only replace `swagger-ui-dist` for wrappers that consume this asset-path contract. Other upstream exports and arbitrary deep imports are not guaranteed. Wrappers that download assets from a CDN, embed their own bundle, or copy a fixed list of files may need explicit asset configuration. `swagger-ui` and `swagger-ui-react` have different JavaScript APIs; use the [browser plugin](../packages/plugin/README.md) where the wrapper exposes a plugin hook.

Do not alias `swagger-ui-express` to `swagger-ui-monaco-express`: this project's Express integration itself composes the original middleware. For an application you control directly, follow the [Express integration instructions](../packages/express/README.md).

## Optional NestJS custom asset path

For a simple `/docs` mount, NestJS also accepts an explicit distribution directory through its [`customSwaggerUiPath` setup option](https://docs.nestjs.com/v11/openapi/introduction#setup-options). After publication, install `swagger-ui-monaco-dist@next` as a direct dependency, then change the existing setup call:

```ts
import { SwaggerModule } from '@nestjs/swagger';
import { getAbsoluteFSPath } from 'swagger-ui-monaco-dist';

// app and document come from your existing NestJS bootstrap.
SwaggerModule.setup('docs', app, document, {
  customSwaggerUiPath: getAbsoluteFSPath(),
});
```

Prefer the dependency override for nested routes or routes combined with a global prefix. In NestJS 11.4.7, the [additional static mount for nested paths](https://github.com/nestjs/swagger/blob/11.4.7/lib/swagger-module.ts) does not receive `customSwaggerUiPath`, so some trailing-slash requests can otherwise serve the original assets. Verify your exact route and NestJS version before choosing the explicit-path approach.
