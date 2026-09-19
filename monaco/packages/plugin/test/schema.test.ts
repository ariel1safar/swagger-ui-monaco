import { describe, expect, it } from 'vitest';
import { getLanguageService } from 'vscode-json-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { createSchemaRegistration, isJsonMediaType, selectResponseSchema, type JsonObject } from '../src/schema';

const documentUri = 'https://example.test/openapi.json';
const modelUri = 'inmemory://swagger/request.json';
function registration(schema: unknown, spec: JsonObject = { openapi: '3.0.4' }, direction: 'request' | 'response' = 'request') {
  return createSchemaRegistration({ spec, schema, documentUri, modelUri, direction });
}
function rootSchema(result: ReturnType<typeof registration>): JsonObject {
  return (result.schema.allOf as JsonObject[])[0];
}

describe('JSON media types and response selection', () => {
  it.each([
    ['application/json', true], ['Application/Problem+JSON; charset=utf-8', true],
    ['text/json', true], ['application/jsonp', false], ['text/plain', false],
    ['application/*', false], [undefined, false],
  ])('recognizes %s as JSON: %s', (value, expected) => {
    expect(isJsonMediaType(value)).toBe(expected);
  });

  const spec = { openapi: '3.1.2', paths: { '/pets': { get: { responses: {
    '200': { content: { 'application/json': { schema: { const: 'exact' } }, 'application/*': { schema: { const: 'type' } }, '*/*': { schema: { const: 'any' } } } },
    '2XX': { content: { 'application/json': { schema: { const: 'range' } } } },
    default: { $ref: '#/components/responses/error~1response' },
  } } } }, components: { responses: { 'error/response': { content: { 'application/problem+json': { schema: { const: 'default' } } } } } } };
  it.each([
    [200, 'Application/JSON; charset=utf-8', 'exact'], [201, 'application/json', 'range'],
    [404, 'application/problem+json', 'default'], [200, 'application/xml', 'type'], [200, 'text/plain', 'any'],
  ])('selects status %s and content type %s', (status, contentType, expected) => {
    expect(selectResponseSchema(spec, '/pets', 'GET', status, contentType)).toEqual({ const: expected });
  });
  it('does not fall back to another response when the exact response lacks that media type', () => {
    expect(selectResponseSchema(spec, '/pets', 'get', 201, 'application/problem+json')).toBeUndefined();
    expect(selectResponseSchema(spec, '/missing', 'get', 200, 'application/json')).toBeUndefined();
  });
  it('uses a parameterized response media type only when its parameters match', () => {
    const document = { paths: { '/x': { get: { responses: { '200': { content: {
      'application/json; profile=v1': { schema: { const: 'profile' } },
      'application/json; profile="v1;stable"': { schema: { const: 'quoted-semicolon' } },
      'application/json; profile="v1\\"quoted\\\\path"': { schema: { const: 'escaped' } },
      'application/json; charset=UTF-8': { schema: { const: 'charset' } },
      'application/json': { schema: { const: 'generic' } },
    } } } } } } };
    expect(selectResponseSchema(document, '/x', 'get', 200, 'application/json')).toEqual({ const: 'generic' });
    expect(selectResponseSchema(document, '/x', 'get', 200, 'application/json; profile=v1')).toEqual({ const: 'profile' });
    expect(selectResponseSchema(document, '/x', 'get', 200, 'application/json; profile=v2')).toEqual({ const: 'generic' });
    expect(selectResponseSchema(document, '/x', 'get', 200, 'application/json; profile="v1;stable"')).toEqual({ const: 'quoted-semicolon' });
    expect(selectResponseSchema(document, '/x', 'get', 200, 'application/json; profile="v1\\"quoted\\\\path"')).toEqual({ const: 'escaped' });
    expect(selectResponseSchema(document, '/x', 'get', 200, 'application/json; charset=utf-8')).toEqual({ const: 'charset' });
  });
});

describe('registered schemas in the real JSON language service', () => {
  function editor(schema: unknown, spec: JsonObject, direction: 'request' | 'response' = 'request') {
    const service = getLanguageService({ schemaRequestService: async uri => { throw new Error(`Unexpected remote request: ${uri}`); } });
    service.configure({ validate: true, schemas: [registration(schema, spec, direction)] });
    const document = (text: string) => TextDocument.create(modelUri, 'json', 1, text);
    return { service, document, validate: async (text: string) => {
      const doc = document(text);
      return service.doValidation(doc, service.parseJSONDocument(doc));
    } };
  }

  it('suppresses directional required fields across sibling allOf branches without changing nested objects', async () => {
    const schema = { allOf: [
      { properties: { id: { type: 'string', readOnly: true }, child: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } } },
      { required: ['id'] },
    ] };
    const { validate } = editor(schema, { openapi: '3.0.4' });
    expect(await validate('{}')).toEqual([]);
    expect((await validate('{"child":{}}')).map(error => error.message)).toEqual(['Missing property "id".']);
  });

  it('warns when a non-2020 dialect would otherwise silently weaken validation', () => {
    const schema = { $schema: 'http://json-schema.org/draft-07/schema#', type: 'array', items: [{ type: 'string' }], additionalItems: false };
    expect(registration(schema, { openapi: '3.1.2' }).warnings.length).toBeGreaterThan(0);
    expect(registration({}, { openapi: '3.1.2', jsonSchemaDialect: 'https://json-schema.org/draft/2019-09/schema' }).warnings.length).toBeGreaterThan(0);
  });

  it('projects repeated references separately without weakening a nested use of the same component', async () => {
    const spec = { openapi: '3.0.4', components: { schemas: { Base: {
      type: 'object', required: ['id'], properties: { id: { type: 'string' } },
    } } } };
    const schema = { allOf: [
      { $ref: '#/components/schemas/Base' }, { $ref: '#/components/schemas/Base' },
      { properties: { id: { readOnly: true }, child: { $ref: '#/components/schemas/Base' } } },
    ] };
    const { validate, service, document } = editor(schema, spec);
    expect(await validate('{}')).toEqual([]);
    expect((await validate('{"child":{}}')).map(error => error.message)).toEqual(['Missing property "id".']);
    const doc = document('{ }');
    const completions = await service.doComplete(doc, doc.positionAt(1), service.parseJSONDocument(doc));
    expect(completions?.items.map(item => item.label)).not.toContain('id');
  });

  it('completes nested recursive properties and keeps hover descriptions while ignoring request-only required fields', async () => {
    const spec = { openapi: '3.0.4', components: { schemas: { Node: {
      type: 'object', required: ['id'], properties: {
        id: { type: 'string', readOnly: true, description: 'Server identifier' },
        mode: { type: 'string', enum: ['safe', 'fast'], default: 'safe' },
        child: { $ref: '#/components/schemas/Node' },
      },
    } } } };
    const { service, document, validate } = editor({ $ref: '#/components/schemas/Node' }, spec);
    expect(await validate('{"child":{}}')).toEqual([]);
    const doc = document('{"child":{ }}');
    const completions = await service.doComplete(doc, doc.positionAt(10), service.parseJSONDocument(doc));
    expect(completions?.items.map(item => item.label)).toContain('mode');
    expect(completions?.items.map(item => item.label)).not.toContain('id');
    const hoverDoc = document('{"id":"abc"}');
    const hover = await service.doHover(hoverDoc, hoverDoc.positionAt(3), service.parseJSONDocument(hoverDoc));
    expect(JSON.stringify(hover?.contents)).toContain('Server identifier');
    const enumDoc = document('{"mode": }');
    const values = await service.doComplete(enumDoc, enumDoc.positionAt(9), service.parseJSONDocument(enumDoc));
    expect(values?.items.map(item => item.label)).toEqual(expect.arrayContaining(['"safe"', '"fast"']));
  });

  it('validates 3.0 nullable and numeric exclusivity, preserving enum constraints', async () => {
    const { validate } = editor({ type: 'object', properties: {
      value: { type: 'string', nullable: true }, restricted: { type: 'string', nullable: true, enum: ['a'] },
      count: { type: 'number', minimum: 1, exclusiveMinimum: true },
    } }, { openapi: '3.0.4' });
    expect(await validate('{"value":null,"count":2}')).toEqual([]);
    expect((await validate('{"restricted":null,"count":1}')).length).toBe(2);
  });

  it('validates 3.1 composition, local escaped pointers, and boolean schemas', async () => {
    const spec = { openapi: '3.1.2', components: { schemas: { 'Name/~': { type: ['string', 'null'] }, Never: false } } };
    const { validate } = editor({ type: 'object', properties: {
      name: { $ref: '#/components/schemas/Name~1~0' },
      value: { oneOf: [{ type: 'number' }, { const: 'auto' }] },
      forbidden: { $ref: '#/components/schemas/Never' },
    } }, spec);
    expect(await validate('{"name":null,"value":"auto"}')).toEqual([]);
    expect((await validate('{"name":3,"value":true,"forbidden":0}')).length).toBe(3);
  });

  it('ignores 3.0 Reference Object siblings and combines 3.1 reference sibling constraints', async () => {
    const components = { schemas: { Number: { type: 'number', minimum: 5 } } };
    const schema = { $ref: '#/components/schemas/Number', type: 'string', minimum: 1, maximum: 4 };
    const legacy = editor(schema, { openapi: '3.0.4', components });
    expect(await legacy.validate('6')).toEqual([]);
    expect((await legacy.validate('"text"')).length).toBeGreaterThan(0);
    const modern = editor({ $ref: '#/components/schemas/Number', minimum: 10 }, { openapi: '3.1.2', components });
    expect((await modern.validate('6')).length).toBeGreaterThan(0);
    expect(await modern.validate('12')).toEqual([]);
  });

  it('removes a request required obligation defined beside composed property schemas', async () => {
    const schema = { allOf: [{ type: 'object', properties: { id: { type: 'string', readOnly: true } } }], required: ['id'] };
    expect(await editor(schema, { openapi: '3.0.4' }).validate('{}')).toEqual([]);
    expect((await editor(schema, { openapi: '3.0.4' }, 'response').validate('{}')).length).toBe(1);
  });

  it('suppresses response writeOnly suggestions and required obligations', async () => {
    const schema = { type: 'object', required: ['secret'], properties: { secret: { type: 'string', writeOnly: true }, name: { type: 'string' } } };
    const { service, document, validate } = editor(schema, { openapi: '3.1.2' }, 'response');
    expect(await validate('{}')).toEqual([]);
    const doc = document('{ }');
    const result = await service.doComplete(doc, doc.positionAt(1), service.parseJSONDocument(doc));
    expect(result?.items.map(item => item.label)).toContain('name');
    expect(result?.items.map(item => item.label)).not.toContain('secret');
  });
});

describe('schema registration', () => {
  it('normalizes 3.0 nullable, example and boolean exclusive bounds without changing data examples', () => {
    const schema = { type: 'object', example: { type: 'string', nullable: true }, properties: {
      name: { type: 'string', nullable: true, enum: ['a'], example: 'a' },
      count: { type: 'number', minimum: 1, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: false },
      composed: { nullable: true, allOf: [{ type: 'string' }] },
    } };
    const before = structuredClone(schema);
    const result = registration(schema);
    expect(result.fileMatch).toEqual([modelUri]);
    expect(result.uri).not.toBe(documentUri);
    expect(rootSchema(result)).toMatchObject({ examples: [{ type: 'string', nullable: true }], properties: {
      name: { type: ['string', 'null'], enum: ['a'], examples: ['a'] },
      count: { type: 'number', exclusiveMinimum: 1, maximum: 10 },
      composed: { allOf: [{ type: 'string' }] },
    } });
    const properties = rootSchema(result).properties as Record<string, JsonObject>;
    expect(properties.count).not.toHaveProperty('minimum');
    expect(properties.count).not.toHaveProperty('exclusiveMaximum');
    expect(properties.composed).not.toHaveProperty('type');
    expect(schema).toEqual(before);
  });

  it('preserves 3.1 JSON Schema constraints and annotation data', () => {
    const schema = { type: ['string', 'null'], nullable: true, examples: [{ $ref: 'a-data-value' }],
      exclusiveMinimum: 2, if: { const: 1 }, then: false, else: { enum: [null, 'a'] },
      prefixItems: [{ type: 'string' }], unevaluatedProperties: false };
    expect(rootSchema(registration(schema, { openapi: '3.1.2' }))).toEqual(schema);
  });

  it.each(['request', 'response'] as const)('projects %s properties through recursive, escaped local references', direction => {
    const spec = { openapi: '3.0.4', components: { schemas: {
      'Node/~': { type: 'object', required: ['id', 'secret', 'name'], properties: {
        id: { $ref: '#/components/schemas/Identifier' },
        secret: { type: 'string', writeOnly: true, description: 'Secret input' },
        name: { type: 'string' }, children: { type: 'array', items: { $ref: '#/components/schemas/Node~1~0' } },
      } }, Identifier: { type: 'string', readOnly: true, description: 'Server ID' },
    } } };
    const before = structuredClone(spec);
    const result = registration({ $ref: '#/components/schemas/Node~1~0' }, spec, direction);
    const schemas = (result.schema.components as { schemas: Record<string, JsonObject> }).schemas;
    const node = schemas['Node/~'];
    const properties = node.properties as Record<string, JsonObject>;
    expect(node.required).toEqual(direction === 'request' ? ['secret', 'name'] : ['id', 'name']);
    expect(properties[direction === 'request' ? 'id' : 'secret'].doNotSuggest).toBe(true);
    expect(properties.secret.description).toBe('Secret input');
    expect(schemas.Identifier.description).toBe('Server ID');
    expect(properties.children.items).toEqual({ $ref: '#/components/schemas/Node~1~0' });
    expect(JSON.parse(JSON.stringify(result.schema))).toEqual(result.schema);
    expect(result.warnings).toEqual([]);
    expect(spec).toEqual(before);
  });

  it('localizes absolute references to the same document and warns without retaining fetchable external refs', () => {
    const spec = { openapi: '3.1.2', components: { schemas: { Name: { type: 'string' } } } };
    const result = registration({ properties: {
      local: { $ref: `${documentUri}#/components/schemas/Name` },
      external: { $ref: 'https://other.test/types.json#/Name', description: 'Name' },
      missing: { $ref: '#/components/schemas/Missing' },
    } }, spec);
    const properties = rootSchema(result).properties as Record<string, JsonObject>;
    expect(properties.local.$ref).toBe('#/components/schemas/Name');
    expect(properties.external).toEqual({ description: 'Name' });
    expect(properties.missing).not.toHaveProperty('$ref');
    expect(result.warnings.join(' ')).toMatch(/external/i);
    expect(result.warnings.join(' ')).toMatch(/unresolved/i);
  });

  it('reports dynamic references and custom dialects without rewriting their semantics', () => {
    const schema = { $schema: 'https://example.test/custom-dialect', $dynamicRef: '#node', $dynamicAnchor: 'node' };
    const result = registration(schema, { openapi: '3.1.2', jsonSchemaDialect: 'https://example.test/custom-dialect' });
    expect(rootSchema(result)).toEqual(schema);
    expect(result.warnings.join(' ')).toMatch(/dynamic/i);
    expect(result.warnings.join(' ')).toMatch(/dialect/i);
  });
});
