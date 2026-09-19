# Swagger UI Monaco packages

Schema-aware Monaco editors for JSON request bodies and object parameters, plus a read-only JSON response viewer for Swagger UI.

This workspace belongs to the independent [`ariel1safar/swagger-ui-monaco`](https://github.com/ariel1safar/swagger-ui-monaco) fork. It is not affiliated with or endorsed by SmartBear Software or the Swagger UI maintainers. Its distribution is built from the pinned `swagger-ui-dist` 5.32.15 npm dependency and Monaco Editor 0.56.0, not from the Swagger UI source at the repository root.

## Publication status

The three packages are preparing their first synchronized preview, `0.1.0-beta.1`. The preview has not been published yet. When available, it will use the npm `next` tag. A later synchronized `0.1.0` release will use `latest` after registry installation smoke tests pass.

| Package | Purpose |
| --- | --- |
| [`swagger-ui-monaco`](packages/plugin/README.md) | Plugin for an existing browser Swagger UI setup. |
| [`swagger-ui-monaco-dist`](packages/dist/README.md) | Complete self-hosted Swagger UI distribution with Monaco assets. |
| [`swagger-ui-monaco-express`](packages/express/README.md) | Express integration compatible with the `swagger-ui-express` API. |

After the preview is published, install from `next`:

```sh
npm install swagger-ui-monaco@next
npm install swagger-ui-monaco-dist@next
npm install swagger-ui-monaco-express@next express
```

## Browser plugin

Copy `node_modules/swagger-ui-monaco/dist/assets/` to a browser-accessible directory, keeping every emitted chunk, stylesheet, font, and worker together. Then configure that directory explicitly:

```js
import { createMonacoPlugin } from 'swagger-ui-monaco';

SwaggerUIBundle({
  url: '/openapi.json',
  plugins: [
    createMonacoPlugin({
      assetBaseUrl: '/docs/monaco/',
      theme: 'auto',
      validateResponses: true,
    }),
  ],
});
```

When `assetBaseUrl` is omitted, the plugin resolves `./monaco/` relative to the document URL. Runtime assets and schemas are self-hosted; the plugin does not fetch them from a CDN.

## Self-hosted distribution

```js
import express from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-monaco-dist';

const app = express();
app.use('/docs', express.static(getAbsoluteFSPath()));
```

`absolutePath` is an alias of `getAbsoluteFSPath`. The default export and the `swagger-ui-monaco-dist/absolute-path` subpath provide the same helper. The enhanced `swagger-ui-bundle.js` resolves Monaco assets relative to its own script URL.

## Express integration

```js
import express from 'express';
import swaggerUi from 'swagger-ui-monaco-express';

const app = express();
const document = {
  openapi: '3.1.0',
  info: { title: 'Example', version: '1.0.0' },
  paths: {},
};
const options = {
  swaggerOptions: {
    monaco: { theme: 'auto', validateResponses: true },
  },
};

app.use(
  '/api-docs',
  swaggerUi.serveFiles(document, options),
  swaggerUi.setup(document, options),
);
```

The package exports `setup`, `serve`, `serveFiles`, `serveWithOptions`, and `generateHTML` with the `swagger-ui-express` 5.0.1 calling conventions. Its middleware serves the enhanced assets before upstream assets.

## Options

Pass options to `createMonacoPlugin(options)`, or use `swaggerOptions.monaco` with the distribution and Express integration. Runtime Swagger UI configuration overrides options used when creating the plugin.

| Option | Default | Effect |
| --- | --- | --- |
| `enabled` | `true` | Enables compatible Monaco surfaces. |
| `requestEditor` | `true` | Replaces compatible JSON request-body editors. |
| `objectParameters` | `true` | Replaces JSON object parameter editors. |
| `responseViewer` | `true` | Replaces compatible JSON response bodies. |
| `validateResponses` | `false` | Enables schema diagnostics in the read-only response viewer. |
| `theme` | `auto` | Uses `light`, `dark`, or the browser color-scheme preference. |
| `assetBaseUrl` | `./monaco/` | Selects the self-hosted Monaco asset directory. |

Request changes are sent to Swagger UI immediately, including an intentionally empty body. Response formatting is display-only: **Show raw**, **Copy raw**, and **Download** preserve the exact response text received from Swagger UI. Unsupported content keeps the original Swagger UI component. If the runtime, stylesheet, or a worker cannot load, a plain textarea remains available.

See [compatibility and schema behavior](docs/compatibility.md) for supported OpenAPI versions, JSON Schema limits, CSP requirements, and tested runtimes.

## Development

Node.js 22.14 or newer is required. Run commands from this directory:

```sh
npm ci
npx playwright install --with-deps chromium
npm run build
npm test
npm run typecheck
npm run lint
npm run test:packages
```

`npm run test:packages` verifies packed files, exports, type declarations, static assets, Express 4 and 5 compatibility, and the browser suite from an isolated installed consumer. See the repository [contribution guide](../CONTRIBUTING.md) and the maintainer [release guide](docs/releasing.md).

## License

The project is licensed under the [Apache License 2.0](../LICENSE). Upstream and bundled third-party notices are recorded in [`../NOTICE`](../NOTICE) and the package-specific notice files.
