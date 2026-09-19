import type * as ReactTypes from 'react';
import type { editor as MonacoEditor } from 'monaco-editor/editor';
import { loadRuntime } from './loader';
import { formatJsonResponse } from './format';
import { createSchemaRegistration, type JsonObject } from './schema';
import type { EditorContext, MonacoOptions } from './types';

interface Props {
  value: string;
  onChange?: (value: string) => void;
  context: EditorContext;
  spec: JsonObject;
  documentUri: string;
  options: MonacoOptions;
  role: 'request' | 'parameter' | 'response';
  disabled?: boolean;
  errors?: string;
}

let nextModel = 0;

export function createEditor(React: typeof ReactTypes) {
  const h = React.createElement;

  return function MonacoEditorView(props: Props) {
    const { context, spec, options, role } = props;
    const readOnly = role === 'response' || props.disabled;
    const container = React.useRef<HTMLDivElement>(null);
    const instance = React.useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
    const latest = React.useRef(props);
    latest.current = props;
    const [value, setValue] = React.useState(props.value);
    const [ready, setReady] = React.useState(false);
    const [failure, setFailure] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);
    const [formatted, setFormatted] = React.useState(false);
    const [notice, setNotice] = React.useState('');
    const [modelUri] = React.useState(() => `inmemory://swagger-monaco/${++nextModel}/${role}.json`);
    const schemaKey = JSON.stringify(context.schema);
    const registration = React.useMemo(() => createSchemaRegistration({
      spec,
      schema: role === 'response' && !options.validateResponses ? {} : context.schema,
      documentUri: props.documentUri,
      modelUri,
      direction: context.direction,
    }), [spec, schemaKey, context.direction, props.documentUri, modelUri, role, options.validateResponses]);

    const change = (text: string) => {
      setValue(text);
      latest.current.onChange?.(text);
    };

    React.useEffect(() => {
      setValue(props.value);
      if (role === 'response') {
        setFormatted(false);
        setNotice('');
      }
      const editor = instance.current;
      const model = editor?.getModel();
      if (model && model.getValue() !== props.value) {
        if (role === 'response') model.setValue(props.value);
        else {
          editor!.pushUndoStop();
          editor!.executeEdits('swagger', [{ range: model.getFullModelRange(), text: props.value }]);
          editor!.pushUndoStop();
        }
      }
    }, [props.value, role]);

    React.useEffect(() => {
      let disposed = false;
      const resources: Array<() => void> = [];
      const cleanup = () => { while (resources.length) resources.pop()!(); };
      setReady(false);
      setFailure(false);
      loadRuntime(options.assetBaseUrl).then(async (runtime) => {
        if (disposed || !container.current) return;
        const { monaco } = runtime;
        const unregister = runtime.registerSchema(registration);
        resources.push(unregister);
        const model = monaco.editor.createModel(latest.current.value, 'json', monaco.Uri.parse(modelUri));
        resources.push(() => model.dispose());
        const theme = options.theme === 'auto' || !options.theme
          ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'vs-dark' : 'vs')
          : options.theme === 'dark' ? 'vs-dark' : 'vs';
        const editor = monaco.editor.create(container.current, {
          model, theme, readOnly: Boolean(readOnly), automaticLayout: true,
          minimap: { enabled: false }, scrollBeyondLastLine: false,
          fontSize: 13, tabSize: 2, wordWrap: 'on', fixedOverflowWidgets: false,
          ariaLabel: `${role} JSON editor`, editContext: false,
          formatOnPaste: false, renderValidationDecorations: 'on',
        });
        instance.current = editor;
        resources.push(() => {
          editor.dispose();
          if (instance.current === editor) instance.current = null;
        });
        const listener = model.onDidChangeContent(() => {
          const text = model.getValue();
          setValue(text);
          if (role !== 'response') latest.current.onChange?.(text);
        });
        resources.push(() => listener.dispose());
        try {
          await runtime.checkWorker(model);
          if (!disposed) setReady(true);
        } catch {
          cleanup();
          if (!disposed) setFailure(true);
        }
      }).catch(() => { cleanup(); if (!disposed) setFailure(true); });
      return () => { disposed = true; cleanup(); };
    }, [registration, modelUri, options.assetBaseUrl, options.theme, readOnly, role]);

    const toggleFormat = () => {
      const text = latest.current.value;
      let next = text;
      if (!formatted) {
        try { next = formatJsonResponse(text); }
        catch { setNotice('This response is not valid JSON. Showing the original text.'); return; }
      }
      instance.current?.setValue(next);
      setFormatted(!formatted);
    };
    const copy = async () => {
      try { await navigator.clipboard.writeText(latest.current.value); setNotice('Copied original response.'); }
      catch { setNotice('Clipboard is unavailable. Select and copy the response text.'); }
    };
    const download = () => {
      const url = URL.createObjectURL(new Blob([latest.current.value], { type: context.mediaType || 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = 'response.json';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const warnings = [...registration.warnings];
    if (/"\$schema"\s*:/.test(value)) warnings.push('A payload $schema field can override editor schema assistance.');

    return h('div', { className: `swagger-monaco${expanded ? ' swagger-monaco-expanded' : ''}`, 'data-monaco-role': role },
      h('div', { className: 'swagger-monaco-toolbar' },
        role === 'response'
          ? h(React.Fragment, null,
            h('button', { type: 'button', onClick: toggleFormat, disabled: !ready }, formatted ? 'Show raw' : 'Format response'),
            h('button', { type: 'button', onClick: copy }, 'Copy raw'),
            h('button', { type: 'button', onClick: download }, 'Download'))
          : h('button', { type: 'button', disabled: !ready || readOnly, onClick: () => instance.current?.getAction('editor.action.formatDocument')?.run() }, 'Format JSON'),
        h('button', { type: 'button', 'aria-expanded': expanded, onClick: () => setExpanded(!expanded) }, expanded ? 'Collapse editor' : 'Expand editor')),
      h('div', { ref: container, className: 'swagger-monaco-canvas', style: { height: expanded ? '70vh' : '240px', display: failure ? 'none' : 'block' } }),
      !ready && h('textarea', {
        className: 'body-param__text swagger-monaco-fallback', 'aria-label': `${role} JSON editor fallback`,
        value, readOnly, onChange: (event: ReactTypes.ChangeEvent<HTMLTextAreaElement>) => change(event.target.value),
      }),
      h('div', { className: 'swagger-monaco-status', role: 'status' },
        failure ? 'Monaco could not load. The text editor remains available.' : !ready ? 'Loading editor…' : '',
        props.errors || '', warnings.join(' '), notice),
    );
  };
}
