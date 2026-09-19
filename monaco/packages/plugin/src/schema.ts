export type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mediaType(value = ''): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

function mediaParameters(value: string): Map<string, string> {
  const parameters = new Map<string, string>();
  for (const match of value.matchAll(/;\s*([^=;\s]+)\s*=\s*("(?:\\.|[^"\\])*"|[^;]*)/g)) {
    const name = match[1].toLowerCase();
    const raw = match[2].trim().replace(/^"|"$/g, '').replace(/\\(.)/g, '$1');
    parameters.set(name, name === 'charset' ? raw.toLowerCase() : raw);
  }
  return parameters;
}

export function isJsonMediaType(value?: string): boolean {
  return /^[^/\s*]+\/(?:json|[^/\s*]+\+json)$/.test(mediaType(value));
}

function pointerParts(reference: string): string[] | undefined {
  if (!reference.startsWith('#/')) return undefined;
  try {
    return decodeURIComponent(reference.slice(2)).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  } catch {
    return undefined;
  }
}

function atPointer(document: JsonObject, reference: string): unknown {
  const parts = pointerParts(reference);
  if (!parts) return undefined;
  let value: unknown = document;
  for (const part of parts) {
    if ((!isObject(value) && !Array.isArray(value)) || !Object.hasOwn(value, part)) return undefined;
    value = (value as JsonObject)[part];
  }
  return value;
}

function resolveObject(document: JsonObject, value: unknown): JsonObject | undefined {
  const seen = new Set<unknown>();
  while (isObject(value) && typeof value.$ref === 'string') {
    if (seen.has(value)) return undefined;
    seen.add(value);
    value = atPointer(document, value.$ref);
  }
  return isObject(value) ? value : undefined;
}

export function selectResponseSchema(spec: JsonObject, path: string, method: string, status: number | string, contentType: string): unknown {
  const paths = isObject(spec.paths) ? spec.paths : {};
  const pathItem = resolveObject(spec, paths[path]);
  const operation = pathItem?.[method.toLowerCase()];
  const responses = isObject(operation) && isObject(operation.responses) ? operation.responses : {};
  const code = String(status);
  const response = resolveObject(spec, responses[code] ?? responses[`${code[0]}XX`] ?? responses.default);
  if (!isObject(response?.content)) return undefined;
  const actualType = mediaType(contentType);
  const actualParameters = mediaParameters(contentType);
  const candidates = [actualType, `${actualType.split('/')[0]}/*`, '*/*'];
  for (const candidate of candidates) {
    const entry = Object.entries(response.content)
      .filter(([key]) => mediaType(key) === candidate && [...mediaParameters(key)].every(([name, value]) => actualParameters.get(name) === value))
      .sort(([a], [b]) => mediaParameters(b).size - mediaParameters(a).size)[0]?.[1];
    if (isObject(entry)) return entry.schema;
  }
  return undefined;
}

const schemaMaps = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'];
const schemaChildren = ['additionalProperties', 'additionalItems', 'contains', 'not', 'if', 'then', 'else', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema'];
const schemaArrays = ['allOf', 'anyOf', 'oneOf', 'prefixItems'];
const knownDialects = new Set([
  'https://spec.openapis.org/oas/3.1/dialect/base',
  'https://json-schema.org/draft/2020-12/schema',
]);

/** Clone the OpenAPI document as a reference registry and project only reachable schemas. */
export function createSchemaRegistration(input: { spec: JsonObject; schema: unknown; documentUri: string; modelUri: string; direction: 'request' | 'response' }): { uri: string; fileMatch: string[]; schema: JsonObject; warnings: string[] } {
  const { spec, documentUri, modelUri, direction } = input;
  const document = structuredClone(spec);
  const warnings = new Set<string>();
  const visited = new Set<JsonObject>();
  const legacy = typeof spec.openapi === 'string' && spec.openapi.startsWith('3.0.');
  const excludedAnnotation = direction === 'request' ? 'readOnly' : 'writeOnly';

  function checkDialect(value: unknown): void {
    if (typeof value === 'string' && !knownDialects.has(value)) {
      warnings.add(`Custom schema dialect is not supported: ${value}`);
    }
  }

  function localReference(reference: string): string | undefined {
    if (reference.startsWith('#')) return reference;
    try {
      const target = new URL(reference, documentUri);
      const source = new URL(documentUri);
      source.hash = '';
      const fragment = target.hash;
      target.hash = '';
      if (target.href === source.href && fragment) return fragment;
    } catch { /* Relative document identities cannot establish an external reference's origin. */ }
    return undefined;
  }

  function excluded(value: unknown, seen = new Set<unknown>()): boolean {
    if (!isObject(value) || seen.has(value)) return false;
    seen.add(value);
    if (value[excludedAnnotation] === true) return true;
    if (typeof value.$ref === 'string' && excluded(atPointer(document, value.$ref), seen)) return true;
    return Array.isArray(value.allOf) && value.allOf.some(child => excluded(child, seen));
  }

  function excludedProperties(value: unknown, result = new Set<string>(), seen = new Set<unknown>()): Set<string> {
    if (!isObject(value) || seen.has(value)) return result;
    seen.add(value);
    if (isObject(value.properties)) {
      for (const [name, property] of Object.entries(value.properties)) if (excluded(property)) result.add(name);
    }
    if (typeof value.$ref === 'string') excludedProperties(atPointer(document, value.$ref), result, seen);
    if (Array.isArray(value.allOf)) value.allOf.forEach(child => excludedProperties(child, result, seen));
    return result;
  }

  function removeConjunctiveRequirements(value: JsonObject, omitted: Set<string>, seen = new Set<unknown>()): void {
    if (!omitted.size || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value.required)) value.required = value.required.filter(name => !omitted.has(name));
    if (isObject(value.properties)) {
      for (const name of omitted) {
        const property = value.properties[name];
        if (isObject(property)) property.doNotSuggest = true;
      }
    }
    if (Array.isArray(value.allOf)) {
      for (const branch of value.allOf) if (isObject(branch)) removeConjunctiveRequirements(branch, omitted, seen);
    }
    if (typeof value.$ref === 'string') {
      const target = atPointer(document, value.$ref);
      if (isObject(target) && !seen.has(target) && hasConjunctiveRequirements(target, omitted)) {
        seen.add(target);
        const projected = structuredClone(target);
        removeConjunctiveRequirements(projected, omitted, seen);
        seen.delete(target);
        delete value.$ref;
        value.allOf = [...(Array.isArray(value.allOf) ? value.allOf : []), projected];
      }
    }
  }

  function hasConjunctiveRequirements(value: unknown, omitted: Set<string>, seen = new Set<unknown>()): boolean {
    if (!isObject(value) || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value.required) && value.required.some(name => omitted.has(name))) return true;
    if (isObject(value.properties) && [...omitted].some(name => isObject(value.properties) && isObject(value.properties[name]) && value.properties[name].doNotSuggest !== true)) return true;
    if (Array.isArray(value.allOf) && value.allOf.some(branch => hasConjunctiveRequirements(branch, omitted, seen))) return true;
    return typeof value.$ref === 'string' && hasConjunctiveRequirements(atPointer(document, value.$ref), omitted, seen);
  }

  function normalize(value: unknown): void {
    if (!isObject(value) || visited.has(value)) return;
    visited.add(value);
    if (typeof value.$ref === 'string') {
      if (legacy) {
        for (const key of Object.keys(value)) if (key !== '$ref') delete value[key];
      } else if (Object.keys(value).length > 1 && isObject(atPointer(document, localReference(value.$ref) ?? ''))) {
        // Monaco merges reference targets over siblings; allOf preserves 3.1 conjunction.
        const reference = { $ref: value.$ref };
        delete value.$ref;
        value.allOf = [reference, ...(Array.isArray(value.allOf) ? value.allOf : [])];
      }
    }
    checkDialect(value.$schema);
    for (const keyword of ['$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor']) {
      if (keyword in value) warnings.add(`${keyword} is not supported by the JSON language service.`);
    }
    if (typeof value.$id === 'string' && !value.$id.startsWith('#')) {
      warnings.add('Schema $id resource scopes are not fully supported; use document-local JSON pointers.');
    }

    if (typeof value.$ref === 'string') {
      const reference = value.$ref;
      const local = localReference(reference);
      const target = local ? atPointer(document, local) : undefined;
      if (target === false) {
        // The language service's reference resolver treats a false target as missing.
        delete value.$ref;
        value.not = {};
      } else if (target === true) {
        delete value.$ref;
      } else if (isObject(target)) {
        value.$ref = local;
        normalize(target);
      } else {
        delete value.$ref;
        warnings.add(local ? `Unresolved local schema reference: ${reference}` : `External schema reference was not fetched: ${reference}`);
      }
    }

    if (legacy) {
      if (value.nullable === true && typeof value.type === 'string') value.type = [value.type, 'null'];
      delete value.nullable;
      for (const [bound, exclusive] of [['minimum', 'exclusiveMinimum'], ['maximum', 'exclusiveMaximum']]) {
        if (typeof value[exclusive] === 'boolean') {
          if (value[exclusive] === true && typeof value[bound] === 'number') {
            value[exclusive] = value[bound];
            delete value[bound];
          } else delete value[exclusive];
        }
      }
    }
    if (Object.hasOwn(value, 'example') && !Object.hasOwn(value, 'examples')) value.examples = [value.example];
    for (const key of schemaMaps) {
      if (isObject(value[key])) Object.values(value[key]).forEach(normalize);
    }
    for (const key of schemaChildren) normalize(value[key]);
    for (const key of schemaArrays) if (Array.isArray(value[key])) value[key].forEach(normalize);
    if (Array.isArray(value.items)) value.items.forEach(normalize);
    else normalize(value.items);
    if (isObject(value.dependencies)) Object.values(value.dependencies).forEach(normalize);

    if (isObject(value.properties)) {
      for (const property of Object.values(value.properties)) {
        if (isObject(property) && excluded(property)) {
          property.doNotSuggest = true;
        }
      }
    }
    const omitted = excludedProperties(value);
    if (Array.isArray(value.required)) value.required = value.required.filter(name => !omitted.has(name));
  }

  checkDialect(spec.jsonSchemaDialect);
  const schema = structuredClone(input.schema ?? {});
  normalize(schema);
  // Reference targets must be fully normalized before making contextual projections.
  for (const normalized of visited) removeConjunctiveRequirements(normalized, excludedProperties(normalized));
  document.allOf = [schema];
  document.$schema = legacy ? 'http://json-schema.org/draft-07/schema#' : 'https://json-schema.org/draft/2020-12/schema';
  return { uri: `${modelUri}.schema.json`, fileMatch: [modelUri], schema: document, warnings: [...warnings] };
}
