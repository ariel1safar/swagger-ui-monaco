export const spec = {
  openapi: '3.0.3',
  info: { title: 'Monaco integration fixture', version: '1' },
  paths: {
    '/download': { get: {
      operationId: 'download',
      responses: { '200': { description: 'Binary file', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } } },
    } },
    '/echo': {
      post: {
        operationId: 'echo',
        parameters: [{ in: 'query', name: 'filter', schema: {
          type: 'object', properties: { category: { type: 'string', enum: ['books', 'music'] } },
        } }],
        requestBody: { content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/Pet' },
            examples: { first: { value: { name: 'Ada', kind: 'cat' } }, second: { value: { name: 'Grace', kind: 'dog' } } },
          },
          'application/vnd.fixture+json': { schema: { type: 'object', properties: { vendorId: { type: 'string' } } } },
          'text/plain': { schema: { type: 'string' }, example: 'plain body' },
        } },
        responses: {
          '200': { description: 'Echo', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
        },
      },
    },
    '/other': {
      post: {
        operationId: 'other',
        requestBody: { content: { 'application/json': { schema: {
          type: 'object', properties: { otherCode: { type: 'integer' } },
        } } } },
        responses: { '200': { description: 'OK' } },
      },
    },
    '/upload': {
      post: {
        operationId: 'upload',
        requestBody: { content: { 'multipart/form-data': { schema: {
          type: 'object', properties: { file: { type: 'string', format: 'binary' } },
        } } } },
        responses: { '200': { description: 'OK' } },
      },
    },
  },
  components: { schemas: { Pet: {
    type: 'object', required: ['id', 'name'],
    properties: {
      id: { type: 'integer', readOnly: true },
      name: { type: 'string', description: 'The name of the pet', default: 'Milo' },
      kind: { type: 'string', enum: ['cat', 'dog'] },
      secret: { type: 'string', writeOnly: true },
      age: { type: 'integer', nullable: true },
    },
  } } },
};
