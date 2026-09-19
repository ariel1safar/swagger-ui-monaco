import type * as ReactTypes from 'react';
import { createEditor } from './editor';
import { isJsonMediaType, selectResponseSchema, type JsonObject } from './schema';
import type { EditorContext, MonacoOptions } from './types.js';

export type { MonacoOptions } from './types.js';

// Swagger's plugin/component boundary is untyped and includes Immutable.js values.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>;
interface System {
  React: typeof ReactTypes;
  getConfigs(): { monaco?: MonacoOptions };
  specSelectors: {
    specJson(): { toJS(): JsonObject };
    specJsonWithResolvedSubtrees?(): { toJS(): JsonObject };
    url(): string;
  };
  oas3Selectors: { requestContentType(path: string, method: string): string | null };
}

const plainObjects = new WeakMap<object, JsonObject>();
function plain(value: Props | undefined): JsonObject {
  if (!value) return {};
  if (typeof value.toJS !== 'function') return value;
  let result = plainObjects.get(value);
  if (!result) {
    result = value.toJS() as JsonObject;
    plainObjects.set(value, result);
  }
  return result;
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** Create a Swagger UI plugin; React and request state remain owned by Swagger UI. */
export function createMonacoPlugin(configuration: MonacoOptions = {}): (system: unknown) => object {
  return function MonacoPlugin(injected: unknown) {
    const system = injected as System;
    const React = system.React;
    const h = React.createElement;
    const Context = React.createContext<EditorContext | null>(null);
    const Editor = createEditor(React);
    const options = () => ({ ...configuration, ...system.getConfigs().monaco });
    const spec = () => plain(system.specSelectors.specJson());
    const supported = () => /^3\.(0|1)\./.test(String(spec().openapi));
    const documentUri = () => {
      const url = system.specSelectors.url();
      return url ? new URL(url, document.baseURI).href : new URL('openapi.json', document.baseURI).href;
    };
    const editorProps = (context: EditorContext) => ({ context, spec: spec(), documentUri: documentUri(), options: options() });

    return {
      statePlugins: {
        oas3: {
          wrapSelectors: {
            requestBodyValue: (original: (path: string, method: string) => unknown) =>
              (state: Props, path: string, method: string) => {
                const config = options();
                // Upstream collapses an intentionally empty body to null, triggering example resets.
                if (config.enabled !== false && config.requestEditor !== false && supported() &&
                  isJsonMediaType(system.oas3Selectors.requestContentType(path, method) ?? '') &&
                  state.getIn(['requestData', path, method, 'bodyValue']) === '') return '';
                return original(path, method);
              },
          },
        },
      },
      wrapComponents: {
        RequestBody: (Original: ReactTypes.ComponentType<Props>) => function RequestContext(props: Props) {
          const body = props.requestBody;
          const mediaType = props.contentType || body?.get('content')?.keySeq().first() || '';
          const context: EditorContext = {
            schema: plain(body?.getIn(['content', mediaType, 'schema'])),
            mediaType,
            identity: `${props.specPath?.toJS?.().join('/') || 'request'}/${mediaType}`,
            direction: 'request',
          };
          return h(Context.Provider, { value: context }, h(Original, props));
        },
        RequestBodyEditor: (Original: ReactTypes.ComponentType<Props>) => function RequestEditor(props: Props) {
          const context = React.useContext(Context);
          const config = options();
          const active = config.enabled !== false && config.requestEditor !== false && supported() && context && isJsonMediaType(context.mediaType);
          React.useEffect(() => {
            if (active && props.value == null) props.onChange(props.defaultValue ?? '');
          }, [active, props.value, props.defaultValue, props.onChange]);
          if (!active || !context) return h(Original, props);
          return h(Editor, {
            ...editorProps(context), key: context.identity, role: 'request',
            value: text(props.value ?? props.defaultValue), onChange: props.onChange,
            errors: props.errors?.toArray?.().join(', '),
          });
        },
        JsonSchema_object: (Original: ReactTypes.ComponentType<Props>) => function ObjectEditor(props: Props) {
          const parent = React.useContext(Context);
          const config = options();
          if (config.enabled === false || config.objectParameters === false || !supported() ||
            (parent && !isJsonMediaType(parent.mediaType))) return h(Original, props);
          const context: EditorContext = {
            schema: plain(props.schema), mediaType: 'application/json',
            identity: `${parent?.identity || 'parameter'}/${props.description || props.keyName || 'object'}`,
            direction: 'request',
          };
          return h(Editor, {
            ...editorProps(context), role: 'parameter', value: text(props.value),
            onChange: props.onChange, disabled: props.disabled,
            errors: props.errors?.size ? text(props.errors.toJS?.() ?? props.errors) : undefined,
          });
        },
        liveResponse: (Original: ReactTypes.ComponentType<Props>) => function ResponseContext(props: Props) {
          const headers = plain(props.response?.get('headers'));
          const mediaType = String(headers['content-type'] || headers['Content-Type'] || '');
          const resolved = system.specSelectors.specJsonWithResolvedSubtrees?.() || system.specSelectors.specJson();
          const context: EditorContext = {
            schema: selectResponseSchema(plain(resolved), props.path, props.method, props.response?.get('status'), mediaType),
            mediaType, identity: `${props.path}/${props.method}/response/${props.response?.get('status')}/${mediaType}`,
            direction: 'response',
          };
          return h(Context.Provider, { value: context }, h(Original, props));
        },
        responseBody: (Original: ReactTypes.ComponentType<Props>) => function ResponseViewer(props: Props) {
          const context = React.useContext(Context);
          const config = options();
          const headers = props.headers || {};
          const attachment = /attachment/i.test(headers['content-disposition'] || headers['Content-Disposition'] || '');
          const fileTransfer = /File Transfer/i.test(headers['content-description'] || headers['Content-Description'] || '');
          if (config.enabled === false || config.responseViewer === false || !supported() || !context ||
            !isJsonMediaType(props.contentType) || attachment || fileTransfer || typeof props.content !== 'string') return h(Original, props);
          return h('div', null, h('h5', null, 'Response body'), h(Editor, {
            ...editorProps(context), key: context.identity, role: 'response', value: props.content,
          }));
        },
      },
    };
  };
}
