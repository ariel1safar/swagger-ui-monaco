import { createMonacoPlugin } from '../../plugin/src/index';

// The upstream UMD bundle is concatenated before this entry at build time.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const original = (globalThis as any).SwaggerUIBundle;
const script = document.currentScript as HTMLScriptElement | null;
const assetBaseUrl = new URL('./monaco/', script?.src || document.baseURI).href;
const plugin = createMonacoPlugin({ assetBaseUrl });

function SwaggerUIBundle(options: Record<string, unknown> = {}) {
  return original({
    ...options,
    plugins: [...(Array.isArray(options.plugins) ? options.plugins : []), plugin],
  });
}
Object.assign(SwaggerUIBundle, original);
Object.defineProperty(globalThis, 'SwaggerUIBundle', { value: SwaggerUIBundle, configurable: true, writable: true });
