# swagger-ui-monaco-dist

A self-hosted Swagger UI distribution with schema-aware Monaco editors and response viewing. The package is built from `swagger-ui-dist` 5.32.15 from npm and includes Monaco Editor 0.56.0. It is not built from the Swagger UI source at the repository root.

This package is part of the independent [Swagger UI Monaco fork](https://github.com/ariel1safar/swagger-ui-monaco). It is not affiliated with or endorsed by SmartBear Software or the Swagger UI maintainers.

## Status and installation

Version `0.1.0-beta.1` is being prepared and has not been published yet. After the preview is published under the npm `next` tag, install it with:

```sh
npm install swagger-ui-monaco-dist@next
```

## Usage

```js
import express from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-monaco-dist';

const app = express();
app.use('/docs', express.static(getAbsoluteFSPath()));
```

`getAbsoluteFSPath()`, its `absolutePath` alias, the default export, and the `swagger-ui-monaco-dist/absolute-path` default export return the installed assets directory. ESM and CommonJS entry points are provided.

The enhanced `swagger-ui-bundle.js` retains the Swagger UI global and appends the Monaco plugin to configured plugins. It resolves the Monaco runtime relative to its own script URL. Serve the complete assets tree, including the `monaco/` chunks, styles, fonts, and workers.

The included `index.html` defaults to `./openapi.json`; applications can provide their own initializer or use [`swagger-ui-monaco-express`](https://github.com/ariel1safar/swagger-ui-monaco/tree/main/monaco/packages/express).

The Monaco surfaces support JSON media types in OpenAPI 3.0.x and 3.1.x. Read the [compatibility and schema behavior guide](https://github.com/ariel1safar/swagger-ui-monaco/blob/main/monaco/docs/compatibility.md) for known limits and CSP requirements.

Licensed under [Apache-2.0](https://github.com/ariel1safar/swagger-ui-monaco/blob/main/LICENSE). See the packaged `NOTICE` for Swagger UI and Monaco Editor attribution and license terms.
