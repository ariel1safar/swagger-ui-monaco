# swagger-ui-monaco

Schema-aware Monaco request editors, object parameter editors, and response viewers for an existing Swagger UI browser setup.

```sh
npm install swagger-ui-monaco
```

```js
import { createMonacoPlugin } from 'swagger-ui-monaco';

SwaggerUIBundle({
  url: '/openapi.json',
  plugins: [createMonacoPlugin({
    assetBaseUrl: '/docs/monaco/',
    theme: 'auto',
    validateResponses: true,
  })],
});
```

Copy the complete `dist/assets/` directory to `assetBaseUrl`. With no explicit URL, assets load from `./monaco/` relative to the document. The package performs no external network fetches for runtime assets or schemas.

Options are `enabled`, `requestEditor`, `objectParameters`, `responseViewer`, `validateResponses`, `theme` (`light`, `dark`, or `auto`), and `assetBaseUrl`. Feature switches default to enabled except response validation, which is opt-in. JSON media types in OpenAPI 3.0.x and 3.1.x are supported.

Request edits update Swagger UI immediately. Response formatting never replaces the stored raw response. If Monaco or a worker cannot load, the original value remains accessible through a plain textarea.

See the repository's compatibility guide for schema-dialect and reference limitations.

Apache-2.0. See `NOTICE` for bundled Monaco Editor attribution and its MIT license.
