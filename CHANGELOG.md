# Changelog

Notable changes to Swagger UI Monaco are recorded here. The project follows [Semantic Versioning](https://semver.org/); prereleases remain subject to change.

## 0.1.0-beta.1 (upcoming)

This first preview has not been published. When released, all three packages will be published together under the npm `next` tag:

- Add `swagger-ui-monaco`, with schema-aware JSON request-body and object-parameter editors, a read-only JSON response viewer, and a plain-text fallback.
- Add `swagger-ui-monaco-dist`, built from the pinned `swagger-ui-dist` 5.32.15 npm dependency and bundled with Monaco Editor 0.56.0.
- Add `swagger-ui-monaco-express`, which composes the enhanced distribution with the `swagger-ui-express` 5.0.1 API.
- Support OpenAPI 3.0.x and 3.1.x schema projection, document-local references, and direction-aware handling of `readOnly` and `writeOnly` properties.
- Add clean-consumer package verification, preserved release artifacts, release metadata validation, and GitHub Actions trusted publishing.

The synchronized stable `0.1.0` release will use the npm `latest` tag after the preview is installed and smoke-tested from the registry.
