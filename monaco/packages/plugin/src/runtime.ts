import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import { jsonDefaults, getWorker } from 'monaco-editor/languages/features/json/register';
// A missing language-mode chunk must reject runtime loading before readiness waits.
import 'monaco-editor/languages/features/json/jsonMode';
import type { createSchemaRegistration } from './schema';

type Registration = ReturnType<typeof createSchemaRegistration>;
const registrations = new Map<string, Registration>();
const originalOptions = jsonDefaults.diagnosticsOptions;
let schemaUpdate: Promise<void> | undefined;
type WorkerResult = { kind: 'ready' | 'retry' | 'disposed' } | { kind: 'error'; error: unknown };

function createGeneration() {
  let notify!: (result: WorkerResult) => void;
  const signal = new Promise<WorkerResult>(resolve => { notify = resolve; });
  return { signal, notify, cleanups: new Set<() => void>() };
}

let generation = createGeneration();
let activeJsonWorker: Worker | undefined;

// Worker creation proves asynchronous JSON mode setup has installed its accessor.
let languageInitialized!: (result: WorkerResult) => void;
const languageReady = new Promise<WorkerResult>(resolve => { languageInitialized = resolve; });

const previousEnvironment = globalThis.MonacoEnvironment;
globalThis.MonacoEnvironment = {
  ...previousEnvironment,
  getWorker(moduleId, label) {
    if (label !== 'json' && label !== 'editorWorkerService') {
      if (previousEnvironment?.getWorker) return previousEnvironment.getWorker(moduleId, label);
      if (previousEnvironment?.getWorkerUrl) return new Worker(previousEnvironment.getWorkerUrl(moduleId, label));
    }
    let worker: Worker;
    try {
      worker = new Worker(new URL(label === 'json' ? './json.worker.js' : './editor.worker.js', import.meta.url), { type: 'module' });
    } catch (error) {
      if (label === 'json') {
        const result: WorkerResult = { kind: 'error', error };
        languageInitialized(result);
        generation.notify(result);
      }
      throw error;
    }
    if (label === 'json') {
      languageInitialized({ kind: 'ready' });
      const owner = generation;
      activeJsonWorker = worker;
      const fail = () => {
        if (owner === generation && activeJsonWorker === worker) {
          owner.notify({ kind: 'error', error: new Error('JSON worker could not load or communicate') });
        }
      };
      const removeListeners = () => {
        worker.removeEventListener('error', fail);
        worker.removeEventListener('messageerror', fail);
        owner.cleanups.delete(removeListeners);
      };
      worker.addEventListener('error', fail);
      worker.addEventListener('messageerror', fail);
      owner.cleanups.add(removeListeners);
      const terminate = worker.terminate.bind(worker);
      worker.terminate = () => {
        removeListeners();
        if (activeJsonWorker === worker) activeJsonWorker = undefined;
        terminate();
      };
    }
    return worker;
  },
};

function updateSchemas() {
  // One defaults change restarts the worker; batch editors mounted in the same render.
  schemaUpdate ??= Promise.resolve().then(() => {
    const previous = generation;
    generation = createGeneration();
    for (const cleanup of previous.cleanups) cleanup();
    previous.notify({ kind: 'retry' });
    jsonDefaults.setDiagnosticsOptions({
    ...originalOptions,
    validate: true,
    enableSchemaRequest: false,
    allowComments: false,
    trailingCommas: 'error',
    schemas: [...(originalOptions.schemas ?? []), ...registrations.values()],
    });
    schemaUpdate = undefined;
  });
}

export { monaco };

export function registerSchema(registration: Registration) {
  registrations.set(registration.uri, registration);
  updateSchemas();
  return () => {
    registrations.delete(registration.uri);
    updateSchemas();
  };
}

export async function checkWorker(model: monaco.editor.ITextModel) {
  if (model.isDisposed()) return;
  let stop!: (result: WorkerResult) => void;
  const disposed = new Promise<WorkerResult>(resolve => { stop = resolve; });
  const subscription = model.onWillDispose(() => stop({ kind: 'disposed' }));
  try {
    const readiness = await Promise.race([languageReady, disposed]);
    if (readiness.kind === 'disposed') return;
    if (readiness.kind === 'error') throw readiness.error;
    while (!model.isDisposed()) {
      await schemaUpdate;
      const started = generation;
      // Monaco does not reject pending RPCs when a worker fails or is terminated.
      const probe = (async (): Promise<WorkerResult> => {
        const worker = await (await getWorker())(model.uri);
        await worker.getMatchingSchemas(model.uri.toString());
        return { kind: 'ready' };
      })().catch((error: unknown): WorkerResult => ({ kind: 'error', error }));
      const result = await Promise.race([probe, started.signal, disposed]);
      if (result.kind === 'disposed') return;
      if (started !== generation || result.kind === 'retry') continue;
      if (result.kind === 'error') throw result.error;
      return;
    }
  } finally {
    subscription.dispose();
  }
}
