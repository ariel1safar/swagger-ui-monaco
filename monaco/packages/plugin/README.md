# swagger-ui-monaco

Schema-aware Monaco request-body and object-parameter editors, plus a read-only JSON response viewer, for an existing Swagger UI browser setup.

This package is part of the independent [Swagger UI Monaco fork](https://github.com/ariel1safar/swagger-ui-monaco). It is not affiliated with or endorsed by SmartBear Software or the Swagger UI maintainers.

## Status and installation

Version `0.1.0-beta.1` is being prepared and has not been published yet. After the preview is published under the npm `next` tag, install it with:

```sh
npm install swagger-ui-monaco@next
```

## Usage

Copy the complete `node_modules/swagger-ui-monaco/dist/assets/` directory to a browser-accessible location. Keep all emitted JavaScript chunks, stylesheets, fonts, `json.worker.js`, and `editor.worker.js` together.

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

With no explicit `assetBaseUrl`, assets load from `./monaco/` relative to the document. The package performs no external network fetches for runtime assets or schemas.

Options are `enabled`, `requestEditor`, `objectParameters`, `responseViewer`, `validateResponses`, `theme` (`light`, `dark`, or `auto`), and `assetBaseUrl`. Feature switches default to enabled except response validation, which is opt-in.

The plugin supports JSON media types in OpenAPI 3.0.x and 3.1.x. Request edits update Swagger UI immediately. Response formatting does not replace the stored raw response. If Monaco, its stylesheet, or a worker cannot load, the value remains accessible through a plain textarea.

Read the [compatibility and schema behavior guide](https://github.com/ariel1safar/swagger-ui-monaco/blob/main/monaco/docs/compatibility.md) for schema dialect, reference, CSP, and Swagger UI version limitations.

Licensed under [Apache-2.0](https://github.com/ariel1safar/swagger-ui-monaco/blob/main/LICENSE). See the packaged `NOTICE` for Monaco Editor attribution and its MIT license.
