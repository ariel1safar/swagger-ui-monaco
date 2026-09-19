# Swagger UI Monaco

Schema-aware Monaco editors for JSON request bodies, object parameters, and JSON responses in Swagger UI.

This standalone workspace lives under `monaco/` in the
[`ariel1safar/swagger-ui-monaco`](https://github.com/ariel1safar/swagger-ui-monaco)
fork. Run the development commands below from this directory. Its distribution
build uses the pinned `swagger-ui-dist` npm dependency, not the upstream source
at the repository root.

The files in this workspace's `.github/workflows/` are retained from the original
standalone project as reference. GitHub does not run nested workflow files;
Monaco CI and publishing are not configured for this fork.

This repository publishes three packages:

| Package | Use it when |
| --- | --- |
| `swagger-ui-monaco` | You already create Swagger UI in the browser and can host the Monaco runtime assets. |
| `swagger-ui-monaco-dist` | You want a self-hosted Swagger UI 5.32.15 distribution with the plugin and Monaco 0.56.0 included. |
| `swagger-ui-monaco-express` | You use `swagger-ui-express` and want a drop-in integration that serves the enhanced distribution first. |

## Browser plugin

```sh
npm install swagger-ui-monaco
```

Copy `node_modules/swagger-ui-monaco/dist/assets/` to a browser-accessible directory, then configure that directory explicitly:

```js
import { createMonacoPlugin } from 'swagger-ui-monaco';

SwaggerUIBundle({
  url: '/openapi.json',
  plugins: [createMonacoPlugin({ assetBaseUrl: '/docs/monaco/' })],
});
```

When `assetBaseUrl` is omitted, the plugin resolves `./monaco/` relative to the document URL. The directory must contain `monaco-runtime.js`, `monaco-runtime.css`, their emitted chunks and styles, and the JSON and editor workers. Keep all of those files together and serve them from the browser; no CDN or runtime package download is used.

## Self-hosted distribution

```sh
npm install swagger-ui-monaco-dist
```

The assets directory contains Swagger UI 5.32.15, the plugin, and Monaco 0.56.0. The enhanced `swagger-ui-bundle.js` finds Monaco assets relative to its own script URL, so it also works when the page and assets are mounted at different paths.

```js
import express from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-monaco-dist';

const app = express();
app.use('/docs', express.static(getAbsoluteFSPath()));
```

`absolutePath` is an alias of `getAbsoluteFSPath`. The default export and the `swagger-ui-monaco-dist/absolute-path` subpath provide the same helper.

## Express integration

```sh
npm install swagger-ui-monaco-express express
```

```js
import express from 'express';
import swaggerUi from 'swagger-ui-monaco-express';

const app = express();
const document = { openapi: '3.1.0', info: { title: 'Example', version: '1' }, paths: {} };
const options = {
  swaggerOptions: {
    monaco: { theme: 'auto', validateResponses: true },
  },
};

app.use('/api-docs', swaggerUi.serveFiles(document, options), swaggerUi.setup(document, options));
```

The package exports `setup`, `serve`, `serveFiles`, `serveWithOptions`, and `generateHTML` with the upstream `swagger-ui-express` 5.0.1 calling conventions. Its static middleware serves the enhanced assets before the upstream assets.

## Options

Pass options to `createMonacoPlugin(options)`, or use `swaggerOptions.monaco` with the distribution and Express integration. Runtime Swagger UI configuration overrides the options used to create the plugin.

| Option | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Enables all compatible Monaco surfaces. |
| `requestEditor` | `true` | Replaces compatible JSON request-body editors. |
| `objectParameters` | `true` | Replaces JSON object parameter editors. |
| `responseViewer` | `true` | Replaces compatible JSON response bodies. |
| `validateResponses` | `false` | Enables schema diagnostics in the read-only response viewer. |
| `theme` | `auto` | Uses `light`, `dark`, or the browser color-scheme preference. |
| `assetBaseUrl` | `./monaco/` | Selects the self-hosted Monaco asset directory. Include a trailing slash for clarity. |

Request changes are sent to Swagger UI immediately, including an intentionally empty body. Response formatting is display-only: **Show raw**, **Copy raw**, and **Download** preserve the exact response text received from Swagger UI. Non-JSON media types, attachments, and unsupported OpenAPI versions keep their original Swagger UI components. If the runtime, stylesheet, or worker cannot load, an editable or read-only plain textarea remains available.

See [compatibility and schema limitations](docs/compatibility.md) before relying on editor diagnostics as validation.

## Development

Node.js 22.14 or newer is required.

```sh
npm ci
npm run build
npm test
npm run typecheck
npm run lint
npx playwright install --with-deps chromium
npm run test:packages
```

`npm run test:packages` packs each workspace, installs the tarballs in an isolated consumer, checks exports and declarations, serves the installed assets, and runs the browser suite with `PACKAGE_FIXTURE_ROOT` pointed at that consumer. It deletes only the unique temporary directory it created.

## Release setup

No release workflow can publish until repository and npm ownership are configured:

1. Add the real public Git repository URL as `repository.url` in the root and all three package manifests. The release workflow requires it to match the current GitHub repository exactly.
2. Confirm that the unscoped names `swagger-ui-monaco`, `swagger-ui-monaco-dist`, and `swagger-ui-monaco-express` are available and that the publishing account owns them. Package names and ownership are not established by this repository.
3. Bootstrap each new package once under the intended npm owner. Use an interactive, short-lived authentication method and publish in dependency order: plugin, distribution, Express integration. Do not store a publish token in the repository.
4. For each package on npmjs.com, configure GitHub Actions as a trusted publisher for this repository and the workflow filename `release.yml`, with direct `npm publish` allowed. Trusted publishing requires a GitHub-hosted runner and npm 11.5.1 or newer; the workflow uses Node 24 and grants only `contents: read` and `id-token: write`.
5. Create and push a signed or annotated `v<version>` tag at the reviewed commit. Run the manual **Release packages** workflow from that tag and enter the same version.

The release workflow rebuilds and repeats all verification before publishing in dependency order. It does not use an npm token. It rejects mismatched package versions, dependency versions, tags, or repository metadata before any publish command runs.

## License

The project is licensed under Apache License 2.0. Bundled and dependent third-party notices are recorded in `NOTICE` and the package-specific notice files.
