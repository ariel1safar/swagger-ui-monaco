import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const workspaceManifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const expectedVersion = workspaceManifest.version;
const expectedRepositoryUrl = 'git+https://github.com/ariel1safar/swagger-ui-monaco.git';
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
    allowedFiles: [
      'dist/THIRD_PARTY_NOTICES.txt',
      'dist/assets/monaco-runtime.js',
      'dist/assets/monaco-runtime.css',
      'dist/assets/json.worker.js',
      'dist/assets/editor.worker.js',
      'dist/index.js',
      'dist/index.cjs',
      'dist/index.d.ts',
    ],
    allowedPatterns: [
      /^dist\/(?:editor|format|loader|runtime|schema|types)\.d\.ts$/,
      /^dist\/assets\/(?:chunk-[A-Z0-9]+\.js(?:\.LEGAL\.txt)?|jsonMode-[A-Z0-9]+\.(?:js|css)|codicon-[A-Z0-9]+\.ttf)$/,
    ],
  },
  {
    directory: 'dist',
    name: 'swagger-ui-monaco-dist',
    requiredFiles: [
      'dist/absolute-path.js',
      'dist/absolute-path.d.cts',
      'dist/THIRD_PARTY_NOTICES.txt',
      'dist/absolute-path.cjs',
      'dist/assets/favicon-16x16.png',
      'dist/assets/favicon-32x32.png',
      'dist/assets/index.html',
      'dist/assets/oauth2-redirect.html',
      'dist/assets/oauth2-redirect.js',
      'dist/assets/swagger-initializer.js',
      'dist/assets/swagger-ui.css',
      'dist/assets/swagger-ui-bundle.js',
      'dist/assets/swagger-ui-bundle.js.LICENSE.txt',
      'dist/assets/swagger-ui-standalone-preset.js',
      'dist/assets/swagger-ui-standalone-preset.js.LICENSE.txt',
      'dist/assets/monaco/monaco-runtime.js',
      'dist/assets/monaco/monaco-runtime.css',
      'dist/assets/monaco/json.worker.js',
      'dist/assets/monaco/editor.worker.js',
    ],
    requiredPatterns: [/^dist\/assets\/monaco\/chunk-.*\.js$/, /^dist\/assets\/monaco\/.*\.css$/, /^dist\/.*\.d\.ts$/],
    allowedFiles: [
      'dist/THIRD_PARTY_NOTICES.txt',
      'dist/index.js',
      'dist/index.cjs',
      'dist/index.d.ts',
      'dist/browser.d.ts',
      'dist/absolute-path.js',
      'dist/absolute-path.cjs',
      'dist/absolute-path.d.ts',
      'dist/absolute-path.d.cts',
      'dist/assets/favicon-16x16.png',
      'dist/assets/favicon-32x32.png',
      'dist/assets/index.html',
      'dist/assets/oauth2-redirect.html',
      'dist/assets/oauth2-redirect.js',
      'dist/assets/swagger-initializer.js',
      'dist/assets/swagger-ui.css',
      'dist/assets/swagger-ui-bundle.js',
      'dist/assets/swagger-ui-bundle.js.LICENSE.txt',
      'dist/assets/swagger-ui-standalone-preset.js',
      'dist/assets/swagger-ui-standalone-preset.js.LICENSE.txt',
      'dist/assets/monaco/monaco-runtime.js',
      'dist/assets/monaco/monaco-runtime.css',
      'dist/assets/monaco/json.worker.js',
      'dist/assets/monaco/editor.worker.js',
    ],
    allowedPatterns: [
      /^dist\/assets\/monaco\/(?:chunk-[A-Z0-9]+\.js(?:\.LEGAL\.txt)?|jsonMode-[A-Z0-9]+\.(?:js|css)|codicon-[A-Z0-9]+\.ttf)$/,
    ],
  },
  {
    directory: 'express',
    name: 'swagger-ui-monaco-express',
    requiredFiles: [],
    requiredPatterns: [/^dist\/.*\.d\.ts$/],
    allowedFiles: ['dist/index.js', 'dist/index.cjs', 'dist/index.d.ts'],
    allowedPatterns: [],
  },
];

const commonPackageFiles = ['package.json', 'README.md', 'LICENSE', 'NOTICE'];

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

async function assertInstalledCopy(definition) {
  const packageDirectory = join(consumer, 'node_modules', definition.name);
  assert.equal((await lstat(packageDirectory)).isSymbolicLink(), false, `${definition.name} must not be a symlink`);
  const installedPath = await realpath(packageDirectory);
  assertInside(installedPath, join(consumer, 'node_modules'), definition.name);
  assert(!installedPath.startsWith(`${root}${sep}`), `${definition.name} resolved into the source checkout`);

  const manifest = JSON.parse(await readFile(join(packageDirectory, 'package.json'), 'utf8'));
  assert.equal(manifest.name, definition.name);
  assert.equal(manifest.version, expectedVersion, `${definition.name} version must match the workspace`);
  assert.deepEqual(manifest.repository, {
    type: 'git',
    url: expectedRepositoryUrl,
    directory: `monaco/packages/${definition.directory}`,
  }, `${definition.name} repository metadata must identify its source directory`);
  if (definition.directory === 'express') {
    assert.equal(manifest.dependencies?.['swagger-ui-monaco-dist'], expectedVersion,
      'Express integration must depend on the exact distribution package version');
  }
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [dependency, version] of Object.entries(manifest[section] ?? {})) {
      assert(!/^(?:workspace|file|link):/.test(String(version)),
        `${definition.name} ${section}.${dependency} contains a local dependency specifier: ${version}`);
    }
  }
}

async function verifyLicenseCompanions() {
  const installedAssets = join(consumer, 'node_modules', 'swagger-ui-monaco-dist', 'dist', 'assets');
  const upstream = createRequire(join(root, 'package.json'))('swagger-ui-dist').getAbsoluteFSPath();
  for (const filename of [
    'swagger-ui-bundle.js.LICENSE.txt',
    'swagger-ui-standalone-preset.js.LICENSE.txt',
  ]) {
    const [installed, original] = await Promise.all([
      readFile(join(installedAssets, filename)),
      readFile(join(upstream, filename)),
    ]);
    assert.deepEqual(installed, original, `${filename} must exactly match swagger-ui-dist`);
  }

  const [installedBundle, upstreamBundle] = await Promise.all([
    readFile(join(installedAssets, 'swagger-ui-bundle.js')),
    readFile(join(upstream, 'swagger-ui-bundle.js')),
  ]);
  assert.deepEqual(installedBundle.subarray(0, upstreamBundle.length), upstreamBundle,
    'enhanced bundle must preserve the upstream bundle bytes');
  assert.match(installedBundle.subarray(upstreamBundle.length).toString('utf8'),
    /^\n\/\* MODIFIED BY swagger-ui-monaco:/,
    'enhanced bundle must identify the appended modification prominently');
}

async function writePackageOutput(tarballs) {
  if (!process.env.PACKAGE_OUTPUT_DIR) return;
  const outputDirectory = resolve(process.env.PACKAGE_OUTPUT_DIR);
  await mkdir(outputDirectory, { recursive: true });
  const existingFiles = await readdir(outputDirectory);
  assert.equal(existingFiles.length, 0,
    `PACKAGE_OUTPUT_DIR must be empty; refusing to overwrite ${existingFiles.join(', ')}`);

  const packages = [];
  for (const tarball of tarballs) {
    const data = await readFile(tarball.path);
    const integrity = `sha512-${createHash('sha512').update(data).digest('base64')}`;
    await copyFile(tarball.path, join(outputDirectory, tarball.filename));
    packages.push({ name: tarball.name, filename: tarball.filename, integrity });
  }
  await writeFile(join(outputDirectory, 'release-manifest.json'), `${JSON.stringify({
    version: expectedVersion,
    packages,
  }, null, 2)}\n`);
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
    assert.equal(packed.version, expectedVersion, `${definition.name} tarball version must match the workspace`);
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
    const allowedFiles = new Set([...commonPackageFiles, ...definition.allowedFiles]);
    for (const file of files) {
      assert(allowedFiles.has(file) || definition.allowedPatterns.some(pattern => pattern.test(file)),
        `${definition.name} tarball contains unexpected file ${file}`);
    }
    tarballs.push({ name: packed.name, filename: packed.filename, path: join(packDirectory, packed.filename) });
  }

  await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));
  run(npm, [
    'install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund',
    ...tarballs.map(tarball => tarball.path),
    'express@5.2.1',
    'swagger-ui-dist@5.32.15',
    'typescript@5.9.3',
    '@types/express@5.0.6',
    '@types/node@24.10.1',
  ], { cwd: consumer });

  for (const definition of packageDefinitions) await assertInstalledCopy(definition);
  await verifyLicenseCompanions();

  const requireFromConsumer = createRequire(join(consumer, 'package.json'));
  const plugin = requireFromConsumer('swagger-ui-monaco');
  assert.equal(typeof plugin.createMonacoPlugin, 'function');
  assert.equal(typeof plugin.createMonacoPlugin({}), 'function');

  const distribution = requireFromConsumer('swagger-ui-monaco-dist');
  assert.equal(typeof distribution.getAbsoluteFSPath, 'function');
  assert.equal(distribution.absolutePath, distribution.getAbsoluteFSPath);
  assertInside(await realpath(distribution.getAbsoluteFSPath()), join(consumer, 'node_modules'), 'distribution assets');
  assert.equal(typeof requireFromConsumer('swagger-ui-monaco-dist/absolute-path'), 'function');
  assert.equal(requireFromConsumer('swagger-ui-monaco-dist/absolute-path.js')(), distribution.getAbsoluteFSPath(),
    'NestJS-compatible absolute-path.js must resolve the installed assets');

  const expressIntegration = requireFromConsumer('swagger-ui-monaco-express');
  for (const name of ['setup', 'serveFiles', 'serveWithOptions', 'generateHTML']) {
    assert.equal(typeof expressIntegration[name], 'function', `${name} must be a function`);
  }
  assert(Array.isArray(expressIntegration.serve), 'serve must be a middleware array');

  await writeFile(join(consumer, 'exports.mjs'), `
import { createMonacoPlugin } from 'swagger-ui-monaco';
import getAssets, { absolutePath, getAbsoluteFSPath } from 'swagger-ui-monaco-dist';
import absolutePathSubpath from 'swagger-ui-monaco-dist/absolute-path';
import absolutePathJsSubpath from 'swagger-ui-monaco-dist/absolute-path.js';
import swagger, { generateHTML, serve, serveFiles, serveWithOptions, setup } from 'swagger-ui-monaco-express';
if (typeof createMonacoPlugin !== 'function' || typeof getAssets !== 'function' ||
    absolutePath !== getAbsoluteFSPath || typeof absolutePathSubpath !== 'function' ||
    absolutePathJsSubpath() !== getAbsoluteFSPath() ||
    typeof setup !== 'function' || typeof serveFiles !== 'function' ||
    typeof serveWithOptions !== 'function' || typeof generateHTML !== 'function' ||
    !Array.isArray(serve) || swagger.setup !== setup) process.exit(1);
`);
  run(process.execPath, [join(consumer, 'exports.mjs')], { cwd: consumer });

  await writeFile(join(consumer, 'types.ts'), `
import { createMonacoPlugin, type MonacoOptions } from 'swagger-ui-monaco';
import getAssets, { absolutePath, getAbsoluteFSPath } from 'swagger-ui-monaco-dist';
import absolutePathSubpath from 'swagger-ui-monaco-dist/absolute-path';
import absolutePathJsSubpath from 'swagger-ui-monaco-dist/absolute-path.js';
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
const paths: string[] = [getAssets(), absolutePath(), absolutePathSubpath(), absolutePathJsSubpath()];
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
import absoluteJs = require('swagger-ui-monaco-dist/absolute-path.js');
import swagger = require('swagger-ui-monaco-express');
import { createMonacoPlugin } from 'swagger-ui-monaco';
const assets: string = absolute();
const assetsJs: string = absoluteJs();
if (getAssets() !== assets || assetsJs !== assets || typeof swagger.setup !== 'function' ||
    typeof createMonacoPlugin({}) !== 'function') process.exit(1);
`);
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--project', join(consumer, 'tsconfig.json')], { cwd: consumer });
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--project', join(consumer, 'tsconfig.json'), '--noEmit', 'false', '--outDir', 'compiled'], { cwd: consumer });
  run(process.execPath, [join(consumer, 'compiled/commonjs.cjs')], { cwd: consumer });

  await verifyHttpAssets(requireFromConsumer);
  const express4Consumer = join(temporaryRoot, 'express4');
  await mkdir(express4Consumer);
  await writeFile(join(express4Consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run(npm, ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', ...tarballs.map(tarball => tarball.path), 'express@4.21.2'], { cwd: express4Consumer });
  await verifyHttpAssets(createRequire(join(express4Consumer, 'package.json')));
  run(npm, ['run', 'test:e2e'], {
    cwd: root,
    env: { ...process.env, PACKAGE_FIXTURE_ROOT: consumer },
  });
  await writePackageOutput(tarballs);
  console.log('Packed package verification passed.');
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
