# Swagger UI Monaco

[![Monaco CI](https://github.com/ariel1safar/swagger-ui-monaco/actions/workflows/monaco-ci.yml/badge.svg)](https://github.com/ariel1safar/swagger-ui-monaco/actions/workflows/monaco-ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Swagger UI Monaco is an independent fork of [Swagger UI](https://github.com/swagger-api/swagger-ui) that adds schema-aware Monaco editors for JSON request bodies and object parameters, plus a read-only JSON response viewer. It is not affiliated with or endorsed by SmartBear Software or the Swagger UI maintainers.

The repository preserves Swagger UI's source and Git history. Active fork development lives in [`monaco/`](monaco/README.md), where the packages are built independently from pinned npm dependencies. In particular, the distribution package uses `swagger-ui-dist` 5.32.15 from npm; it is not built from the Swagger UI source at the repository root.

## Packages

All three packages are currently preparing the `0.1.0-beta.1` preview. They have not been published yet. The preview will use the npm `next` tag; the synchronized stable `0.1.0` release will later use `latest`.

| Package | Choose it when |
| --- | --- |
| [`swagger-ui-monaco`](monaco/packages/plugin/README.md) | You already initialize Swagger UI in a browser and can host the Monaco runtime assets. |
| [`swagger-ui-monaco-dist`](monaco/packages/dist/README.md) | You want a self-hosted Swagger UI 5.32.15 distribution with the plugin and Monaco Editor 0.56.0 included. |
| [`swagger-ui-monaco-express`](monaco/packages/express/README.md) | You use Express and want middleware compatible with the `swagger-ui-express` API. |

After the preview is published, install the package you need from `next`:

```sh
npm install swagger-ui-monaco@next
npm install swagger-ui-monaco-dist@next
npm install swagger-ui-monaco-express@next express
```

### Browser plugin

```js
import { createMonacoPlugin } from 'swagger-ui-monaco';

SwaggerUIBundle({
  url: '/openapi.json',
  plugins: [createMonacoPlugin({ assetBaseUrl: '/docs/monaco/' })],
});
```

Copy the plugin's complete `dist/assets/` directory to `/docs/monaco/` or another browser-accessible path.

### Self-hosted distribution

```js
import express from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-monaco-dist';

const app = express();
app.use('/docs', express.static(getAbsoluteFSPath()));
```

### Express integration

```js
import express from 'express';
import swaggerUi from 'swagger-ui-monaco-express';

const app = express();
const document = {
  openapi: '3.1.0',
  info: { title: 'Example', version: '1.0.0' },
  paths: {},
};

app.use(
  '/api-docs',
  swaggerUi.serveFiles(document),
  swaggerUi.setup(document),
);
```

## Compatibility

The Monaco surfaces support OpenAPI 3.0.x and 3.1.x documents with JSON media types. Swagger/OpenAPI 2.0, YAML bodies, multipart bodies, binary bodies, and arbitrary text media types keep Swagger UI's original components. Schema assistance is advisory: remote references, anchors, dynamic references, recursive references, and some JSON Schema dialect behavior are limited.

Read the full [compatibility and schema behavior guide](monaco/docs/compatibility.md) before relying on editor diagnostics.

## Development

Fork development runs from the standalone Monaco workspace:

```sh
cd monaco
npm ci
npm run build
npm test
npm run typecheck
npm run lint
```

See [Contributing](CONTRIBUTING.md) for test expectations and [Releasing](monaco/docs/releasing.md) for the preview release process.

## Security

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/ariel1safar/swagger-ui-monaco/security/advisories/new). Do not open a public issue for a suspected vulnerability. See the [security policy](SECURITY.md) for supported versions.

## Upstream and license

This fork retains the upstream Swagger UI source, history, Apache License 2.0 terms, and legal notices. See [LICENSE](LICENSE) and [NOTICE](NOTICE). Swagger and Swagger UI are trademarks of SmartBear Software Inc.; their use here describes compatibility and origin.
