import type * as Runtime from './runtime';

const loads = new Map<string, Promise<typeof Runtime>>();

export function loadRuntime(assetBaseUrl?: string): Promise<typeof Runtime> {
  const base = new URL(assetBaseUrl || './monaco/', document.baseURI);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const url = new URL('monaco-runtime.js', base).href;
  let loading = loads.get(url);
  if (!loading) {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('monaco-runtime.css', base).href;
    const style = new Promise<void>((resolve, reject) => {
      css.onload = () => resolve();
      css.onerror = () => reject(new Error('Editor stylesheet could not be loaded'));
    });
    document.head.append(css);
    loading = Promise.all([import(/* webpackIgnore: true */ url) as Promise<typeof Runtime>, style])
      .then(([runtime]) => runtime)
      .catch((error: unknown) => {
        loads.delete(url);
        css.remove();
        throw error;
      });
    loads.set(url, loading);
  }
  return loading;
}
