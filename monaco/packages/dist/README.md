# swagger-ui-monaco-dist

A self-hosted Swagger UI distribution with schema-aware Monaco surfaces. Version 0.1.0 bundles Swagger UI 5.32.15, the `swagger-ui-monaco` plugin, and Monaco Editor 0.56.0.

```sh
npm install swagger-ui-monaco-dist
```

```js
import express from 'express';
import { getAbsoluteFSPath } from 'swagger-ui-monaco-dist';

const app = express();
app.use('/docs', express.static(getAbsoluteFSPath()));
```

`getAbsoluteFSPath()`, its `absolutePath` alias, the default export, and the `swagger-ui-monaco-dist/absolute-path` default export return the installed `assets` directory. Both ESM and CommonJS entry points are provided.

The enhanced `swagger-ui-bundle.js` retains the upstream global and appends the Monaco plugin to any configured plugins. It resolves Monaco runtime assets relative to its own script URL. Serve the complete assets tree, including the `monaco/` chunks, styles, fonts, and workers.

The included `index.html` defaults to `./openapi.json`; applications can instead provide their own initializer or use the Express integration.

Apache-2.0. See `NOTICE` for Swagger UI and Monaco Editor attribution and license terms.
