import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { spec } from './spec.mjs';

const require = createRequire(process.env.PACKAGE_FIXTURE_ROOT
  ? pathToFileURL(`${process.env.PACKAGE_FIXTURE_ROOT}/package.json`)
  : import.meta.url);
const express = require('express');
const swagger = require(process.env.MONACO_BASELINE ? 'swagger-ui-express' : 'swagger-ui-monaco-express');
const app = express();
app.use('/plugin-assets', express.static(dirname(require.resolve('swagger-ui-monaco'))));
app.use('/stock-assets', express.static(require('swagger-ui-dist').getAbsoluteFSPath()));
app.get('/plugin', (_req, res) => res
  .set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; worker-src 'self'; img-src 'self' data:; object-src 'none'")
  .type('html').send('<!doctype html><html><head><link rel="stylesheet" href="/stock-assets/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/stock-assets/swagger-ui-bundle.js"></script><script type="module" src="/plugin-init.js"></script></body></html>'));
app.get('/plugin-init.js', (_req, res) => res.type('js').send(`
  import { createMonacoPlugin } from '/plugin-assets/index.js';
  SwaggerUIBundle({dom_id:'#swagger-ui',spec:${JSON.stringify(spec)},validatorUrl:null,plugins:[createMonacoPlugin({assetBaseUrl:'/plugin-assets/assets/'})]});
`));
app.get('/health', (_req, res) => res.send('ok'));
app.post('/echo', express.text({ type: '*/*' }), (req, res) => {
  res.set('Content-Type', 'application/json').send(req.body || '');
});
app.post('/other', (_req, res) => res.json({ otherCode: 5 }));
app.get('/download', (_req, res) => res.attachment('fixture.bin').send(Buffer.from([0, 255, 1, 128])));
app.post('/upload', express.raw({ type: '*/*' }), (req, res) => res.json({ received: req.body.toString() }));
const opts = { swaggerOptions: { validatorUrl: null, monaco: { validateResponses: true } } };
app.use('/api/docs', swagger.serveFiles(spec, opts), swagger.setup(spec, opts));
app.use('/api/second', swagger.serveFiles({ ...spec, info: { title: 'Second specification', version: '2' } }, opts),
  swagger.setup({ ...spec, info: { title: 'Second specification', version: '2' } }, opts));
const modern = structuredClone(spec);
modern.openapi = '3.1.2';
modern.components.schemas.Pet.properties.age = { type: ['integer', 'null'] };
app.use('/api/modern', swagger.serveFiles(modern, opts), swagger.setup(modern, opts));
app.get('/multi', (_req, res) => res.type('html').send('<!doctype html><html><head><link rel="stylesheet" href="/api/docs/swagger-ui.css"></head><body><div id="one"></div><div id="two"></div><script src="/api/docs/swagger-ui-bundle.js"></script><script src="/multi-init.js"></script></body></html>'));
app.get('/multi-init.js', (_req, res) => res.type('js').send(`
  SwaggerUIBundle({dom_id:'#one',spec:${JSON.stringify(spec)},validatorUrl:null});
  SwaggerUIBundle({dom_id:'#two',spec:${JSON.stringify(modern)},validatorUrl:null});
`));
app.listen(4173, '127.0.0.1');
