import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const temporaryRoot = await mkdtemp(join(tmpdir(), 'swagger-ui-monaco-packages-'));
const packDirectory = join(temporaryRoot, 'tarballs');
const consumer = join(temporaryRoot, 'consumer');
const packageDefinitions = [
  {
    directory: 'plugin',
    name: 'swagger-ui-monaco',
    requiredFiles: [
      'dist/THIRD_PARTY_NOTICES.txt',
      'dist/assets/monaco-runtime.js',
      'dist/assets/monaco-runtime.css',
      'dist/assets/json.worker.js',
      'dist/assets/editor.worker.js',
    ],
    requiredPatterns: [/^dist\/assets\/chunk-.*\.js$/, /^dist\/assets\/.*\.css$/, /^dist\/.*\.d\.ts$/],
  },
  {
    directory: 'dist',
    name: 'swagger-ui-monaco-dist',
    requiredFiles: [
      'dist/absolute-path.js',
      'dist/absolute-path.d.cts',
      'dist/THIRD_PARTY_NOTICES.txt',
      'dist/absolute-path.cjs',
      'dist/assets/swagger-ui.css',
      'dist/assets/swagger-ui-bundle.js',
      'dist/assets/swagger-ui-standalone-preset.js',
      'dist/assets/monaco/monaco-runtime.js',
      'dist/assets/monaco/monaco-runtime.css',
      'dist/assets/monaco/json.worker.js',
      'dist/assets/monaco/editor.worker.js',
    ],
    requiredPatterns: [/^dist\/assets\/monaco\/chunk-.*\.js$/, /^dist\/assets\/monaco\/.*\.css$/, /^dist\/.*\.d\.ts$/],
  },
  {
    directory: 'express',
    name: 'swagger-ui-monaco-express',
    requiredFiles: [],
    requiredPatterns: [/^dist\/.*\.d\.ts$/],
  },
];

function run(command, args, { capture = false, ...options } = {}) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    ...options,
  });
}

function assertInside(path, parent, description) {
  const pathFromParent = relative(parent, path);
  assert(pathFromParent && !pathFromParent.startsWith(`..${sep}`) && pathFromParent !== '..' && !isAbsolute(pathFromParent),
    `${description} resolved outside ${parent}: ${path}`);
}

async function assertInstalledCopy(name) {
  const packageDirectory = join(consumer, 'node_modules', name);
  assert.equal((await lstat(packageDirectory)).isSymbolicLink(), false, `${name} must not be a symlink`);
  const installedPath = await realpath(packageDirectory);
  assertInside(installedPath, join(consumer, 'node_modules'), name);
  assert(!installedPath.startsWith(`${root}${sep}`), `${name} resolved into the source checkout`);

  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dependency, version] of Object.entries(manifest[section] ?? {})) {
      assert(!/^(?:workspace|file|link):/.test(String(version)),
        `${name} ${section}.${dependency} contains a local dependency specifier: ${version}`);
    }
  }
}

async function verifyHttpAssets(requireFromConsumer) {
  const express = requireFromConsumer('express');
  const swagger = requireFromConsumer('swagger-ui-monaco-express');
  const assetsPath = requireFromConsumer('swagger-ui-monaco-dist').getAbsoluteFSPath();
  const spec = {
    openapi: '3.1.0',
    info: { title: 'Installed package smoke test', version: '1' },
    paths: {},
  };
  const options = { swaggerOptions: { validatorUrl: null } };
  const app = express();
  app.use('/docs', swagger.serveFiles(spec, options), swagger.setup(spec, options));
  const server = await new Promise((resolveServer) => {
    const listening = app.listen(0, '127.0.0.1', () => resolveServer(listening));
  });

  try {
    const address = server.address();
    assert(address && typeof address === 'object');
    const baseUrl = `http://127.0.0.1:${address.port}/docs`;
    const html = await (await fetch(`${baseUrl}/`)).text();
    assert.match(html, /swagger-ui-bundle\.js/, 'setup HTML must bootstrap Swagger UI');

    for (const asset of [
      'swagger-ui.css',
      'swagger-ui-bundle.js',
      'monaco/monaco-runtime.js',
      'monaco/monaco-runtime.css',
      'monaco/json.worker.js',
      'monaco/editor.worker.js',
    ]) {
      const response = await fetch(`${baseUrl}/${asset}`);
      assert.equal(response.status, 200, `${asset} was not served`);
      const installed = await readFile(join(assetsPath, asset));
      const served = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(served, installed, `${asset} did not come from the installed enhanced distribution`);
    }
  } finally {
    await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
  }
}

try {
  await mkdir(packDirectory, { recursive: true });
  await mkdir(consumer, { recursive: true });

  const tarballs = [];
  for (const definition of packageDefinitions) {
    const output = run(npm, [
      'pack', '--json', '--pack-destination', packDirectory, join(root, 'packages', definition.directory),
    ], { capture: true });
    const [packed] = JSON.parse(output);
    assert.equal(packed.name, definition.name);
    const files = new Set(packed.files.map(file => file.path));
    for (const commonFile of ['package.json', 'README.md', 'LICENSE', 'NOTICE', 'dist/index.js', 'dist/index.cjs', 'dist/index.d.ts']) {
      assert(files.has(commonFile), `${definition.name} tarball is missing ${commonFile}`);
    }
    for (const requiredFile of definition.requiredFiles) {
      assert(files.has(requiredFile), `${definition.name} tarball is missing ${requiredFile}`);
    }
    for (const pattern of definition.requiredPatterns) {
      assert([...files].some(file => pattern.test(file)), `${definition.name} tarball has no file matching ${pattern}`);
    }
    tarballs.push(join(packDirectory, packed.filename));
  }

  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));
  run(npm, [
    'install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund',
    ...tarballs,
    'express@5.2.1',
    'swagger-ui-dist@5.32.15',
    'typescript@5.9.3',
    '@types/express@5.0.6',
    '@types/node@24.10.1',
  ], { cwd: consumer });

  for (const definition of packageDefinitions) await assertInstalledCopy(definition.name);

  const requireFromConsumer = createRequire(join(consumer, 'package.json'));
  const plugin = requireFromConsumer('swagger-ui-monaco');
  assert.equal(typeof plugin.createMonacoPlugin, 'function');
  assert.equal(typeof plugin.createMonacoPlugin({}), 'function');

  const distribution = requireFromConsumer('swagger-ui-monaco-dist');
  assert.equal(typeof distribution.getAbsoluteFSPath, 'function');
  assert.equal(distribution.absolutePath, distribution.getAbsoluteFSPath);
  assertInside(await realpath(distribution.getAbsoluteFSPath()), join(consumer, 'node_modules'), 'distribution assets');
  assert.equal(typeof requireFromConsumer('swagger-ui-monaco-dist/absolute-path'), 'function');

  const expressIntegration = requireFromConsumer('swagger-ui-monaco-express');
  for (const name of ['setup', 'serveFiles', 'serveWithOptions', 'generateHTML']) {
    assert.equal(typeof expressIntegration[name], 'function', `${name} must be a function`);
  }
  assert(Array.isArray(expressIntegration.serve), 'serve must be a middleware array');

  await writeFile(join(consumer, 'exports.mjs'), `
import { createMonacoPlugin } from 'swagger-ui-monaco';
import getAssets, { absolutePath, getAbsoluteFSPath } from 'swagger-ui-monaco-dist';
import absolutePathSubpath from 'swagger-ui-monaco-dist/absolute-path';
import swagger, { generateHTML, serve, serveFiles, serveWithOptions, setup } from 'swagger-ui-monaco-express';
if (typeof createMonacoPlugin !== 'function' || typeof getAssets !== 'function' ||
    absolutePath !== getAbsoluteFSPath || typeof absolutePathSubpath !== 'function' ||
    typeof setup !== 'function' || typeof serveFiles !== 'function' ||
    typeof serveWithOptions !== 'function' || typeof generateHTML !== 'function' ||
    !Array.isArray(serve) || swagger.setup !== setup) process.exit(1);
`);
  run(process.execPath, [join(consumer, 'exports.mjs')], { cwd: consumer });

  await writeFile(join(consumer, 'types.ts'), `
import { createMonacoPlugin, type MonacoOptions } from 'swagger-ui-monaco';
import getAssets, { absolutePath, getAbsoluteFSPath } from 'swagger-ui-monaco-dist';
import absolutePathSubpath from 'swagger-ui-monaco-dist/absolute-path';
import swagger, { generateHTML, serve, serveFiles, serveWithOptions, setup } from 'swagger-ui-monaco-express';
const options: MonacoOptions = {
  enabled: true,
  requestEditor: true,
  objectParameters: true,
  responseViewer: true,
  validateResponses: true,
  theme: 'auto',
  assetBaseUrl: '/docs/monaco/',
};
createMonacoPlugin(options);
const paths: string[] = [getAssets(), absolutePath(), absolutePathSubpath()];
void [paths, swagger, generateHTML, serve, serveFiles, serveWithOptions, setup];
`);
  await writeFile(join(consumer, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      types: ['node'],
    },
    include: ['types.ts', 'commonjs.cts'],
  }, null, 2));
  await writeFile(join(consumer, 'commonjs.cts'), `
import getAssets from 'swagger-ui-monaco-dist';
import absolute = require('swagger-ui-monaco-dist/absolute-path');
import swagger = require('swagger-ui-monaco-express');
import { createMonacoPlugin } from 'swagger-ui-monaco';
const assets: string = absolute();
if (getAssets() !== assets || typeof swagger.setup !== 'function' ||
    typeof createMonacoPlugin({}) !== 'function') process.exit(1);
`);
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--project', join(consumer, 'tsconfig.json')], { cwd: consumer });
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--project', join(consumer, 'tsconfig.json'), '--noEmit', 'false', '--outDir', 'compiled'], { cwd: consumer });
  run(process.execPath, [join(consumer, 'compiled/commonjs.cjs')], { cwd: consumer });

  await verifyHttpAssets(requireFromConsumer);
  const express4Consumer = join(temporaryRoot, 'express4');
  await mkdir(express4Consumer);
  await writeFile(join(express4Consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(npm, ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', ...tarballs, 'express@4.21.2'], { cwd: express4Consumer });
  await verifyHttpAssets(createRequire(join(express4Consumer, 'package.json')));
  run(npm, ['run', 'test:e2e'], {
    cwd: root,
    env: { ...process.env, PACKAGE_FIXTURE_ROOT: consumer },
  });
  console.log('Packed package verification passed.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
