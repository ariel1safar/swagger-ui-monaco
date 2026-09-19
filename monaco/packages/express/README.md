# swagger-ui-monaco-express

Express middleware that composes `swagger-ui-express` 5.0.1 with the enhanced assets from `swagger-ui-monaco-dist`.

This package is part of the independent [Swagger UI Monaco fork](https://github.com/ariel1safar/swagger-ui-monaco). It is not affiliated with or endorsed by SmartBear Software or the Swagger UI maintainers.

## Status and installation

Version `0.1.0-beta.1` is being prepared and has not been published yet. After the preview is published under the npm `next` tag, install it with:

```sh
npm install swagger-ui-monaco-express@next express
```

## Usage

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

Named and default exports provide `setup`, `serve`, `serveFiles`, `serveWithOptions`, and `generateHTML`. Serving helpers prepend the enhanced static directory, then delegate to the corresponding `swagger-ui-express` middleware. Existing setup options, custom CSS, and Swagger UI options continue through that API; Monaco options belong at `swaggerOptions.monaco`.

Node.js 22.14 or newer is required. Express `^4.21.2` and `^5.0.0` are accepted as peers. The Monaco surfaces support JSON media types in OpenAPI 3.0.x and 3.1.x.

Read the [compatibility and schema behavior guide](https://github.com/ariel1safar/swagger-ui-monaco/blob/main/monaco/docs/compatibility.md) for known schema and browser limits.

Licensed under [Apache-2.0](https://github.com/ariel1safar/swagger-ui-monaco/blob/main/LICENSE). See the packaged `NOTICE` for third-party attribution and license terms.
