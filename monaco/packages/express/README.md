# swagger-ui-monaco-express

Express middleware that composes `swagger-ui-express` 5.0.1 with the enhanced assets from `swagger-ui-monaco-dist`.

```sh
npm install swagger-ui-monaco-express express
```

```js
import express from 'express';
import swaggerUi from 'swagger-ui-monaco-express';

const app = express();
const document = { openapi: '3.1.0', info: { title: 'Example', version: '1' }, paths: {} };
const options = { swaggerOptions: { monaco: { theme: 'auto' } } };

app.use('/api-docs', swaggerUi.serveFiles(document, options), swaggerUi.setup(document, options));
```

Named and default exports provide `setup`, `serve`, `serveFiles`, `serveWithOptions`, and `generateHTML`. The serving helpers prepend the enhanced static directory and then delegate to the corresponding upstream middleware. Existing `swagger-ui-express` setup options, custom CSS, and Swagger UI options continue through the upstream API; Monaco options belong at `swaggerOptions.monaco`.

Node.js 22.14 or newer is required. Express `^4.21.2` and `^5.0.0` are accepted as peers.

Apache-2.0. See `NOTICE` for third-party attribution and license terms.
