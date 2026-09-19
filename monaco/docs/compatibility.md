# Compatibility and schema behavior

This guide describes the upcoming `0.1.0-beta.1` preview. The preview has not been published yet. Swagger UI Monaco is an independent fork and is not an official Swagger UI release.

## Supported inputs

The plugin activates for OpenAPI `3.0.x` and `3.1.x` documents and JSON media types: `application/json` and structured suffixes such as `application/problem+json`. It does not add YAML editing, Swagger/OpenAPI 2.0 support, multipart editing, or editors for arbitrary text and binary bodies.

Swagger UI still owns request state, execution, examples, authorization, and rendering outside the replaced components. The request editor calls Swagger UI's change handler on every edit. An empty body stays empty rather than being replaced by an example.

The response viewer is read-only. It selects response schemas by exact status, then `nXX`, then `default`, and selects content by exact media type, type wildcard, then `*/*`. Attachments and non-string or non-JSON bodies use the original Swagger UI response component. Response schema diagnostics are opt-in through `validateResponses`.

## Schema assistance is advisory

Completions and diagnostics come from Monaco's JSON language service. They improve editing but are not a complete OpenAPI or JSON Schema validator and must not be used as a security or server-side validation boundary.

For OpenAPI 3.0, the registry projects the selected schema into draft-07 form and normalizes common OpenAPI differences such as `nullable`, boolean exclusive bounds, examples, and `$ref` siblings. For OpenAPI 3.1, it uses a draft 2020-12 registry, but full 2020-12 semantics are not guaranteed.

Known limits:

- `$dynamicRef`, `$dynamicAnchor`, `$recursiveRef`, and `$recursiveAnchor` are reported as unsupported.
- `$id` resource scopes are not fully supported. Non-fragment `$id` values produce a warning; use document-local JSON Pointer references where possible.
- Plain `$anchor` targets are not resolved. A reference such as `#name` is treated as unresolved; use `#/...` pointers.
- Unknown `$schema` and `jsonSchemaDialect` values produce a custom-dialect warning. The recognized identifiers are the OpenAPI 3.1 base dialect and JSON Schema 2020-12.
- A literal `$schema` property in a JSON instance can change Monaco's schema association. The editor warns when it sees one.
- Remote and other external `$ref` targets are never fetched. Unresolved references are removed from the editor registry and reported, so the rest of the reachable schema can still provide assistance.
- Circular document-local pointers are tolerated, but unsupported reference/resource semantics may reduce completions or diagnostics.

The registry is cloned for each editor. For request editing, properties marked `readOnly: true` are hidden from suggestions and removed from the projected `required` list. For response diagnostics, the equivalent suppression applies to `writeOnly: true`. Direct properties, local `$ref` targets, and `allOf` composition are considered; this projection does not replace application-level validation.

## Browser and asset behavior

The plugin loads `monaco-runtime.js` and `monaco-runtime.css` from `assetBaseUrl`, along with emitted JavaScript/CSS/font chunks and `json.worker.js` and `editor.worker.js`. All assets are self-hosted. Serve the full generated directory without renaming individual files.

The standalone browser plugin defaults to `./monaco/` relative to the current page. The enhanced distribution calculates the Monaco URL relative to `swagger-ui-bundle.js`, which allows the document page to live at a different URL. A restrictive Content Security Policy must permit the module scripts, styles, fonts, and module workers from that asset origin.

The browser suite exercises same-origin assets with `script-src 'self'`, `worker-src 'self'`, and `style-src 'self' 'unsafe-inline'`. Monaco and Swagger use dynamic inline styles; policies that prohibit all inline styles need additional integration. No `unsafe-eval` or CDN is needed for this configuration.

The plain textarea is shown while Monaco starts and remains if the runtime, CSS, or worker fails. This fallback preserves editing and response access but does not provide Monaco formatting, completion, or diagnostics.

## Supported package/runtime versions

Version `0.1.0-beta.1` is built and tested with:

- Node.js 22.14 or newer for the Node helpers, build, package verification, and Express integration
- Swagger UI distribution 5.32.15 in `swagger-ui-monaco-dist`
- Monaco Editor 0.56.0 in the bundled browser assets, with its DOMPurify dependency updated to 3.4.15 for published security fixes
- `swagger-ui-express` 5.0.1 in `swagger-ui-monaco-express`
- Express 5.2.1 with the full browser suite, plus Express 4.21.2 middleware and static-asset smoke tests

Other Swagger UI versions may consume the browser plugin, but its integration points are internal component names rather than a versioned Swagger UI plugin contract. Test the exact Swagger UI version used by the application. The distribution and Express packages use the pinned versions above and are not built from the Swagger UI source at the repository root.
