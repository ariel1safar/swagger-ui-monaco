import { expect, test, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function tryOperation(page: Page, id = 'echo') {
  const operation = page.locator(`#operations-default-${id}`);
  await operation.locator('.opblock-summary').click();
  await expect(operation.getByRole('button', { name: 'Try it out' })).toBeVisible();
  await operation.getByRole('button', { name: 'Try it out' }).click();
  return operation;
}

async function replace(editor: Locator, text: string) {
  await expect(editor.getByRole('button', { name: 'Format JSON', exact: true })).toBeEnabled();
  const input = editor.locator('textarea.inputarea');
  await input.focus();
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  if (text) await editor.page().keyboard.insertText(text);
}

test('request editor completes from the operation schema and sends the latest text', async ({ page }) => {
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  const editor = operation.locator('[data-monaco-role="request"]');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await replace(editor, '{');
  await editor.locator('textarea.inputarea').press('Control+Space');
  await expect(editor.locator('.suggest-widget.visible')).toContainText('name');
  await expect(editor.locator('.suggest-widget.visible')).toContainText('kind');
  await editor.locator('textarea.inputarea').press('Escape');
  await replace(editor, '{"name":"Latest","kind":"cat"}');
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  expect((await request).postData()).toBe('{"name":"Latest","kind":"cat"}');
  await expect(operation.locator('[data-monaco-role="response"] .monaco-editor')).toBeVisible();
});

test('each simultaneous operation completes only its own schema and releases its models', async ({ page }) => {
  await page.goto('/api/docs/');
  const first = await tryOperation(page);
  const second = await tryOperation(page, 'other');
  const other = second.locator('[data-monaco-role="request"]');
  await replace(other, '{');
  await other.locator('textarea.inputarea').press('Control+Space');
  await expect(other.locator('.suggest-widget.visible')).toContainText('otherCode');
  await expect(other.locator('.suggest-widget.visible')).not.toContainText('kind');
  await other.locator('textarea.inputarea').press('Escape');
  const request = first.locator('[data-monaco-role="request"]');
  await replace(request, '{');
  await request.locator('textarea.inputarea').press('Control+Space');
  await expect(request.locator('.suggest-widget.visible')).toContainText('kind');
  await expect(request.locator('.suggest-widget.visible')).not.toContainText('otherCode');
  await request.locator('textarea.inputarea').press('Escape');
  await first.locator('.opblock-summary').click();
  await second.locator('.opblock-summary').click();
  await expect(page.locator('.monaco-editor')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const url = '/api/docs/monaco/monaco-runtime.js';
    const runtime = await import(/* webpackIgnore: true */ url);
    return runtime.monaco.editor.getModels().length;
  })).toBe(0);
});

test('object parameters retain upstream serialization and undo survives request edits', async ({ page }) => {
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  const parameter = operation.locator('[data-monaco-role="parameter"]');
  await replace(parameter, '{"category":"music"}');
  const body = operation.locator('[data-monaco-role="request"]');
  await replace(body, '{"name":"Undo"}');
  await parameter.locator('textarea.inputarea').focus();
  await parameter.locator('textarea.inputarea').press('ControlOrMeta+Z');
  await expect(parameter.locator('.view-lines')).not.toContainText('music');
  await parameter.locator('textarea.inputarea').press('ControlOrMeta+Shift+Z');
  await expect(parameter.locator('.view-lines')).toContainText('music');
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  const sent = await request;
  expect(new URL(sent.url()).searchParams.get('category')).toBe('music');
  expect(sent.postData()).toBe('{"name":"Undo"}');
});

test('example and media controls update the editor while non-JSON and files retain their controls', async ({ page }) => {
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  const body = operation.locator('[data-monaco-role="request"]');
  await expect(body.getByRole('button', { name: 'Format JSON' })).toBeEnabled();
  await operation.locator('.examples-select select').selectOption('second');
  await expect(body.locator('.view-lines')).toContainText('Grace');
  await operation.getByRole('combobox', { name: 'Request content type' }).selectOption('application/vnd.fixture+json');
  await replace(body, '{');
  await body.locator('textarea.inputarea').press('Control+Space');
  await expect(body.locator('.suggest-widget.visible')).toContainText('vendorId');
  await body.locator('textarea.inputarea').press('Escape');
  await operation.getByRole('combobox', { name: 'Request content type' }).selectOption('text/plain');
  await expect(operation.locator('[data-monaco-role="request"]')).toHaveCount(0);
  await expect(operation.locator('.body-param textarea')).toBeVisible();
  const upload = await tryOperation(page, 'upload');
  await upload.locator('input[type="file"]').setInputFiles({ name: 'example.txt', mimeType: 'text/plain', buffer: Buffer.from('upload proof') });
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/upload' && req.method() === 'POST');
  const response = page.waitForResponse(res => new URL(res.url()).pathname === '/upload');
  await upload.getByRole('button', { name: 'Execute', exact: true }).click();
  const sent = await request;
  expect(sent.headers()['content-type']).toContain('multipart/form-data; boundary=');
  expect((await (await response).json()).received).toContain('upload proof');
});

test('read-only response formatting preserves the original copy and download bytes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const raw = '{"name":"Exact","number":9007199254740993}\n';
  await page.route('**/echo?*', route => route.fulfill({ contentType: 'application/json', body: raw }));
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  await expect(operation.locator('[data-monaco-role="request"] button').first()).toBeEnabled();
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  const response = operation.locator('[data-monaco-role="response"]');
  await expect(response.getByRole('button', { name: 'Format response' })).toBeEnabled();
  await response.getByRole('button', { name: 'Format response' }).click();
  await expect(response.locator('.view-lines')).toContainText('9007199254740993');
  await response.getByRole('button', { name: 'Copy raw' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
  const downloadEvent = page.waitForEvent('download');
  await response.getByRole('button', { name: 'Download' }).click();
  const download = await downloadEvent;
  expect(await readFile((await download.path())!, 'utf8')).toBe(raw);
  await response.getByRole('button', { name: 'Show raw' }).click();
  await response.locator('textarea.inputarea').focus();
  await page.keyboard.insertText('cannot edit');
  await expect(response.locator('.view-lines')).not.toContainText('cannot edit');
  await response.getByRole('button', { name: 'Format response' }).click();
  await page.route('**/echo?*', route => route.fulfill({ contentType: 'application/json', body: '{"name":"Next response"}' }));
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  await expect(response.locator('.view-lines')).toContainText('Next response');
  await expect(response.getByRole('button', { name: 'Format response' })).toBeEnabled();
});

test('worker failure falls back to an editable body without losing the request', async ({ page }) => {
  await page.route('**/json.worker.js', route => route.abort());
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  const fallback = operation.getByRole('textbox', { name: 'request JSON editor fallback' });
  await expect(operation.locator('[data-monaco-role="request"] [role="status"]')).toContainText('could not load');
  await fallback.fill('{"name":"Fallback"}');
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  expect((await request).postData()).toBe('{"name":"Fallback"}');
  await expect.poll(() => page.evaluate(async () => {
    const url = '/api/docs/monaco/monaco-runtime.js';
    const { monaco } = await import(/* webpackIgnore: true */ url);
    return monaco.editor.getModels().filter((model: { uri: { path: string } }) => !model.uri.path.endsWith('/response.json')).length;
  })).toBe(0);
});

test('OpenAPI 3.1 JSON editing works and payload $schema never triggers a network fetch', async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('schemas.invalid')) remoteRequests.push(request.url()); });
  await page.goto('/api/modern/');
  const operation = await tryOperation(page);
  const body = operation.locator('[data-monaco-role="request"]');
  await replace(body, '{"$schema":"https://schemas.invalid/private","name":"Modern","age":null}');
  await expect(body.getByRole('status')).toContainText('payload $schema');
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ $schema: 'https://schemas.invalid/private', name: 'Modern', age: null });
  await page.evaluate(async () => {
    const url = '/api/modern/monaco/monaco-runtime.js';
    const runtime = await import(/* webpackIgnore: true */ url);
    const model = runtime.monaco.editor.getModels().find((model: { uri: { path: string } }) => model.uri.path.endsWith('/request.json'));
    await runtime.checkWorker(model);
  });
  expect(remoteRequests).toEqual([]);
});

test('two Swagger instances keep editor state independent and nested routes serve their own specification', async ({ page }) => {
  await page.goto('/multi');
  for (const id of ['one', 'two']) {
    const operation = page.locator(`#${id} #operations-default-echo`);
    await operation.locator('.opblock-summary').click();
    await operation.getByRole('button', { name: 'Try it out' }).click();
    await replace(operation.locator('[data-monaco-role="request"]'), `{"name":"${id}"}`);
  }
  await expect(page.locator('#one [data-monaco-role="request"] .view-lines')).toContainText('one');
  await expect(page.locator('#two [data-monaco-role="request"] .view-lines')).toContainText('two');
  await page.goto('/api/second/');
  await expect(page.getByRole('heading', { name: /Second specification/ })).toBeVisible();
  await page.goto('/api/docs/');
  await expect(page.getByRole('heading', { name: /Monaco integration fixture/ })).toBeVisible();
});

test('empty request body is not replaced by an example', async ({ page }) => {
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  const editor = operation.locator('[data-monaco-role="request"]');
  await expect(editor.locator('.monaco-editor')).toBeVisible();
  await replace(editor, '');
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  expect((await request).postData() ?? '').toBe('');
});

test('executing the displayed default sends that example without first editing', async ({ page }) => {
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  await expect(operation.locator('[data-monaco-role="request"]').getByRole('button', { name: 'Format JSON' })).toBeEnabled();
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ name: 'Ada', kind: 'cat' });
});

test('standalone plugin works with stock Swagger UI and self-hosted CSP assets', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', message => { if (/violates.*Content Security Policy/i.test(message.text())) violations.push(message.text()); });
  await page.goto('/plugin');
  const operation = await tryOperation(page);
  const body = operation.locator('[data-monaco-role="request"]');
  await replace(body, '{"name":"Plugin"}');
  await body.getByRole('button', { name: 'Expand editor' }).click();
  await expect(body.getByRole('button', { name: 'Collapse editor' })).toHaveAttribute('aria-expanded', 'true');
  await body.getByRole('button', { name: 'Format JSON', exact: true }).click();
  await expect(body.locator('.view-line')).toHaveCount(3);
  await body.getByRole('button', { name: 'Collapse editor' }).click();
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ name: 'Plugin' });
  expect(violations).toEqual([]);
});

test('invalid JSON responses remain available as raw text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const raw = '{"broken":';
  await page.route('**/echo?*', route => route.fulfill({ contentType: 'application/json', body: raw }));
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  const response = operation.locator('[data-monaco-role="response"]');
  await expect(response.getByRole('button', { name: 'Format response' })).toBeEnabled();
  await response.getByRole('button', { name: 'Format response' }).click();
  await expect(response.getByRole('status')).toContainText('not valid JSON');
  await response.getByRole('button', { name: 'Copy raw' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(raw);
});

test('binary responses retain upstream downloads with unchanged bytes', async ({ page }) => {
  await page.goto('/api/docs/');
  const operation = await tryOperation(page, 'download');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  const link = operation.getByRole('link', { name: 'Download file', exact: true });
  await expect(link).toBeVisible();
  await expect(operation.locator('[data-monaco-role="response"]')).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await link.click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('fixture.bin');
  expect(await readFile((await download.path())!)).toEqual(Buffer.from([0, 255, 1, 128]));
});

test('schema diagnostics stay advisory and response diagnostics use the response schema', async ({ page }) => {
  await page.goto('/api/docs/');
  const operation = await tryOperation(page);
  const body = operation.locator('[data-monaco-role="request"]');
  await replace(body, '{"name":7,"kind":"cat"}');
  const messages = (role: string) => page.evaluate(async (surface) => {
    const url = '/api/docs/monaco/monaco-runtime.js';
    const { monaco } = await import(/* webpackIgnore: true */ url);
    return monaco.editor.getModelMarkers({}).filter((marker: { resource: { path: string } }) =>
      marker.resource.path.endsWith(`/${surface}.json`)).map((marker: { message: string }) => marker.message).join('\n');
  }, role);
  await expect.poll(() => messages('request')).toContain('string');
  const request = page.waitForRequest(req => new URL(req.url()).pathname === '/echo' && req.method() === 'POST');
  await operation.getByRole('button', { name: 'Execute', exact: true }).click();
  expect((await request).postDataJSON()).toEqual({ name: 7, kind: 'cat' });
  await expect(operation.locator('[data-monaco-role="response"] .monaco-editor')).toBeVisible();
  await expect.poll(() => messages('response')).toContain('id');
  await expect.poll(() => messages('response')).toContain('string');
});
