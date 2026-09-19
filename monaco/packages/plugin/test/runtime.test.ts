import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { editor } from 'monaco-editor/editor';

const mocks = vi.hoisted(() => ({ getWorker: vi.fn(), setDiagnosticsOptions: vi.fn() }));
vi.mock('monaco-editor/editor', () => ({}));
vi.mock('monaco-editor/features/register.all', () => ({}));
vi.mock('monaco-editor/languages/features/json/jsonMode', () => ({}));
vi.mock('monaco-editor/languages/features/json/register', () => ({
  jsonDefaults: { diagnosticsOptions: {}, setDiagnosticsOptions: mocks.setDiagnosticsOptions },
  getWorker: mocks.getWorker,
}));

class TestWorker extends EventTarget {
  static instances: TestWorker[] = [];
  terminate = vi.fn();
  constructor() { super(); TestWorker.instances.push(this); }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function modelFixture(activate = true) {
  if (activate) globalThis.MonacoEnvironment!.getWorker!('workerMain.js', 'json');
  let disposed = false;
  const listeners = new Set<() => void>();
  const model = {
    uri: { toString: () => 'inmemory://test.json' },
    isDisposed: () => disposed,
    onWillDispose: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  } as unknown as editor.ITextModel;
  return { model, listeners, dispose() { disposed = true; for (const listener of listeners) listener(); } };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.getWorker.mockReset();
  TestWorker.instances = [];
  vi.stubGlobal('Worker', TestWorker);
  vi.stubGlobal('MonacoEnvironment', undefined);
});
afterEach(() => { vi.unstubAllGlobals(); });

it.each(['error', 'messageerror'])('rejects startup on Worker %s even when Monaco leaves its RPC pending', async eventType => {
  const started = deferred<void>();
  mocks.getWorker.mockImplementation(async () => () => {
    started.resolve();
    return new Promise(() => {});
  });
  const runtime = await import('../src/runtime');
  const { model, listeners } = modelFixture();
  const check = runtime.checkWorker(model);
  const rejection = expect(check).rejects.toThrow('JSON worker');
  await started.promise;
  TestWorker.instances[0].dispatchEvent(new Event(eventType));
  await rejection;
  expect(listeners.size).toBe(0);
});

it('removes failure listeners when Monaco terminates a worker', async () => {
  const matching = vi.fn().mockResolvedValue([]);
  mocks.getWorker.mockImplementation(async () => async () => {
    const oldWorker = TestWorker.instances[0];
    const remove = vi.spyOn(oldWorker, 'removeEventListener');
    oldWorker.terminate();
    expect(remove).toHaveBeenCalledTimes(2);
    globalThis.MonacoEnvironment!.getWorker!('workerMain.js', 'json');
    oldWorker.dispatchEvent(new Event('error'));
    return { getMatchingSchemas: matching };
  });
  const runtime = await import('../src/runtime');
  await runtime.checkWorker(modelFixture().model);
  expect(matching).toHaveBeenCalledTimes(1);
});

it('retries a pending RPC after schemas change and ignores the old worker error', async () => {
  const started = deferred<void>();
  const matching = vi.fn().mockResolvedValue([]);
  let attempts = 0;
  mocks.getWorker.mockImplementation(async () => async () => {
    globalThis.MonacoEnvironment!.getWorker!('workerMain.js', 'json');
    if (++attempts === 1) {
      started.resolve();
      return new Promise(() => {});
    }
    TestWorker.instances[0].dispatchEvent(new Event('error'));
    return { getMatchingSchemas: matching };
  });
  const runtime = await import('../src/runtime');
  const { model, listeners } = modelFixture();
  const check = runtime.checkWorker(model);
  await started.promise;
  runtime.registerSchema({ uri: 'inmemory://schema', fileMatch: [], schema: {}, warnings: [] });
  await check;
  expect(matching).toHaveBeenCalledWith('inmemory://test.json');
  expect(attempts).toBe(2);
  expect(listeners.size).toBe(0);
});

it('settles a pending startup and removes listeners when its model is disposed', async () => {
  const started = deferred<void>();
  mocks.getWorker.mockImplementation(async () => () => {
    started.resolve();
    return new Promise(() => {});
  });
  const runtime = await import('../src/runtime');
  const fixture = modelFixture();
  const check = runtime.checkWorker(fixture.model);
  await started.promise;
  fixture.dispose();
  await check;
  expect(fixture.listeners.size).toBe(0);
});

it('waits for asynchronous JSON language activation before probing the worker', async () => {
  const matching = vi.fn().mockResolvedValue([]);
  mocks.getWorker.mockResolvedValue(async () => ({ getMatchingSchemas: matching }));
  const runtime = await import('../src/runtime');
  const { model } = modelFixture(false);
  const check = runtime.checkWorker(model);
  await Promise.resolve();
  expect(mocks.getWorker).not.toHaveBeenCalled();
  globalThis.MonacoEnvironment!.getWorker!('workerMain.js', 'json');
  await check;
  expect(matching).toHaveBeenCalledTimes(1);
});

it('rejects readiness when worker construction throws', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker denied'); } });
  const runtime = await import('../src/runtime');
  const check = runtime.checkWorker(modelFixture(false).model);
  const rejection = expect(check).rejects.toThrow('Worker denied');
  expect(() => globalThis.MonacoEnvironment!.getWorker!('workerMain.js', 'json')).toThrow('Worker denied');
  await rejection;
});
