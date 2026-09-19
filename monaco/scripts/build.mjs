import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const plugin = resolve(root, 'packages/plugin/dist');
const dist = resolve(root, 'packages/dist/dist');
for (const name of ['plugin', 'dist', 'express']) {
  await rm(resolve(root, `packages/${name}/dist`), { recursive: true, force: true });
  await mkdir(resolve(root, `packages/${name}/dist`), { recursive: true });
}
const common = { bundle: true, target: 'es2022', logLevel: 'warning', legalComments: 'external' };
for (const format of ['esm', 'cjs']) {
  await build({ ...common, entryPoints: ['packages/plugin/src/index.ts'], format,
    outfile: `${plugin}/index.${format === 'esm' ? 'js' : 'cjs'}` });
}
await build({ ...common,
  entryPoints: {
    'monaco-runtime': 'packages/plugin/src/runtime.ts',
    'json.worker': require.resolve('monaco-editor/languages/features/json/json.worker'),
    'editor.worker': require.resolve('monaco-editor/editor/editor.worker'),
  },
  outdir: `${plugin}/assets`, format: 'esm', splitting: true, minify: true,
  loader: { '.ttf': 'file' }, assetNames: '[name]-[hash]',
});
const css = await readFile('packages/plugin/src/editor.css', 'utf8');
await writeFile(`${plugin}/assets/monaco-runtime.css`, `${await readFile(`${plugin}/assets/monaco-runtime.css`, 'utf8')}\n${css}`);
const noticeFiles = [
  'node_modules/monaco-editor/ThirdPartyNotices.txt',
  'node_modules/jsonc-parser/LICENSE.md',
  'node_modules/dompurify/LICENSE',
  'node_modules/marked/LICENSE.md',
];
const notices = await Promise.all(noticeFiles.map(async file => `${file}\n\n${await readFile(file, 'utf8')}`));
await writeFile(`${plugin}/THIRD_PARTY_NOTICES.txt`, notices.join('\n\n'));
await cp(`${plugin}/THIRD_PARTY_NOTICES.txt`, `${dist}/THIRD_PARTY_NOTICES.txt`);

const upstream = require('swagger-ui-dist').getAbsoluteFSPath();
await mkdir(`${dist}/assets`, { recursive: true });
for (const file of ['swagger-ui.css', 'swagger-ui-standalone-preset.js', 'oauth2-redirect.html', 'oauth2-redirect.js', 'favicon-16x16.png', 'favicon-32x32.png']) {
  await cp(resolve(upstream, file), `${dist}/assets/${file}`);
}
await cp(`${plugin}/assets`, `${dist}/assets/monaco`, { recursive: true });
const bootstrap = await build({ ...common, legalComments: 'inline', entryPoints: ['packages/dist/src/browser.ts'], format: 'iife', write: false });
await writeFile(`${dist}/assets/swagger-ui-bundle.js`, `${await readFile(resolve(upstream, 'swagger-ui-bundle.js'), 'utf8')}\n;${bootstrap.outputFiles[0].text}`);
await writeFile(`${dist}/assets/swagger-initializer.js`, `window.onload = function () { window.ui = SwaggerUIBundle({ dom_id: '#swagger-ui', url: './openapi.json', validatorUrl: null, presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset], layout: 'StandaloneLayout' }); };\n`);
await writeFile(`${dist}/assets/index.html`, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Swagger UI Monaco</title><link rel="stylesheet" href="./swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="./swagger-ui-bundle.js"></script><script src="./swagger-ui-standalone-preset.js"></script><script src="./swagger-initializer.js"></script></body></html>\n');
await build({ ...common, entryPoints: ['packages/dist/src/index.ts'], outfile: `${dist}/index.js`, platform: 'node', format: 'esm' });
await writeFile(`${dist}/index.cjs`, "const path = require('node:path');\nconst getAbsoluteFSPath = () => path.join(__dirname, 'assets');\nmodule.exports = { getAbsoluteFSPath, absolutePath: getAbsoluteFSPath, default: getAbsoluteFSPath };\nObject.defineProperty(module.exports, '__esModule', { value: true });\n");
await writeFile(`${dist}/absolute-path.js`, "export { getAbsoluteFSPath as default } from './index.js';\n");
await writeFile(`${dist}/absolute-path.d.ts`, "export { getAbsoluteFSPath as default } from './index.js';\n");
await writeFile(`${dist}/absolute-path.d.cts`, "declare function getAbsoluteFSPath(): string;\nexport = getAbsoluteFSPath;\n");
await writeFile(`${dist}/absolute-path.cjs`, "module.exports = require('./index.cjs').getAbsoluteFSPath;\n");
for (const format of ['esm', 'cjs']) {
  await build({ ...common, entryPoints: ['packages/express/src/index.ts'], platform: 'node', packages: 'external', external: ['swagger-ui-monaco-dist'], format,
    outfile: `packages/express/dist/index.${format === 'esm' ? 'js' : 'cjs'}` });
}
execFileSync('npx', ['tsc', '--project', 'tsconfig.build.json'], { stdio: 'inherit', cwd: root });
for (const name of ['plugin', 'dist', 'express']) {
  await cp(`.work/types/${name}/src`, `packages/${name}/dist`, { recursive: true });
}
console.log('Built plugin, self-hosted distribution, and Express integration.');
