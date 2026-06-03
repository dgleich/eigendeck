// CodeMirror 6 editor for a single notebook code cell. Lazy-loads
// the CodeMirror modules + the language grammar on first mount so
// decks without editable notebooks don't pay the cost.
//
// Language support:
//   - python via @codemirror/lang-python (full grammar + indent)
//   - julia / r / sql / shell / etc. via @codemirror/legacy-modes
//     (StreamLanguage wrappers over the CM5 modes)
//   - anything else: plain text editing (no grammar)
//
// Shift-Enter runs the cell (onRun); the keymap intercepts it before
// CodeMirror inserts a newline. Edits flow out via onChange; the
// parent decides when to commit them (we commit on blur, not per
// keystroke — see NotebookContent).

import { useEffect, useRef } from 'react';

export interface NotebookCellEditorProps {
  value: string;
  /** Kernel language for the grammar (e.g. 'python', 'julia', 'r'). */
  language: string | null;
  /** Base font size in slide-pixels (matches the cell's --nb-base-size). */
  fontSize: number;
  onChange: (next: string) => void;
  /** Shift-Enter handler. */
  onRun: () => void;
  /** Fired when the editor loses focus — parent commits the edit. */
  onBlur?: () => void;
}

// Module-level singletons so the heavy imports resolve once.
type CM = typeof import('@codemirror/view') & {
  state: typeof import('@codemirror/state');
  commands: typeof import('@codemirror/commands');
};
let cmPromise: Promise<CM> | null = null;
function loadCM(): Promise<CM> {
  if (!cmPromise) {
    cmPromise = Promise.all([
      import('@codemirror/view'),
      import('@codemirror/state'),
      import('@codemirror/commands'),
    ]).then(([view, state, commands]) =>
      Object.assign({}, view, { state, commands }) as CM
    );
  }
  return cmPromise;
}

// Resolve a CodeMirror language extension for the kernel language.
// Returns null for plaintext. Lazy per-language so we only pull the
// grammar the deck actually uses.
async function languageExtension(language: string | null): Promise<unknown | null> {
  if (!language) return null;
  const l = language.toLowerCase();
  try {
    if (l === 'python' || l.startsWith('python')) {
      const m = await import('@codemirror/lang-python');
      return m.python();
    }
    // legacy-modes: StreamLanguage wrappers.
    const { StreamLanguage } = await import('@codemirror/language');
    if (l === 'julia') {
      const m = await import('@codemirror/legacy-modes/mode/julia');
      return StreamLanguage.define(m.julia);
    }
    if (l === 'r' || l === 'ir') {
      const m = await import('@codemirror/legacy-modes/mode/r');
      return StreamLanguage.define(m.r);
    }
    if (l === 'sql') {
      const m = await import('@codemirror/legacy-modes/mode/sql');
      return StreamLanguage.define(m.standardSQL);
    }
    if (l === 'shell' || l === 'bash' || l === 'sh') {
      const m = await import('@codemirror/legacy-modes/mode/shell');
      return StreamLanguage.define(m.shell);
    }
  } catch {
    // Grammar module missing → plaintext editing.
  }
  return null;
}

export function NotebookCellEditor({
  value, language, fontSize, onChange, onRun, onBlur,
}: NotebookCellEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks in refs so the CodeMirror instance
  // (created once) always calls the current handler without rebuild.
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;
  const onRunRef = useRef(onRun); onRunRef.current = onRun;
  const onBlurRef = useRef(onBlur); onBlurRef.current = onBlur;
  // Editor view, created async. Stored to apply external value
  // updates + teardown.
  const viewRef = useRef<import('@codemirror/view').EditorView | null>(null);

  useEffect(() => {
    let cancelled = false;
    let view: import('@codemirror/view').EditorView | null = null;

    (async () => {
      const cm = await loadCM();
      const langExt = await languageExtension(language);
      if (cancelled || !hostRef.current) return;

      const { EditorView, keymap, lineNumbers } = cm;
      const { EditorState } = cm.state;
      const { defaultKeymap, history, historyKeymap, indentWithTab } = cm.commands;

      const runKeymap = keymap.of([{
        key: 'Shift-Enter',
        run: () => { onRunRef.current(); return true; },
      }]);

      const updateListener = EditorView.updateListener.of((u) => {
        if (u.docChanged) onChangeRef.current(u.state.doc.toString());
      });
      const blurListener = EditorView.domEventHandlers({
        blur: () => { onBlurRef.current?.(); return false; },
      });

      // Font size matches the cell's code size so the editor doesn't
      // jump when switching between static + editing. Colors come from
      // the notebook's theme CSS variables (set on .nb-frame) so the
      // editor integrates with light/dark/custom slide themes instead
      // of CodeMirror's default black-on-white.
      const theme = EditorView.theme({
        '&': {
          fontSize: `${fontSize}px`,
          backgroundColor: 'transparent',
          color: 'var(--nb-fg, #111827)',
        },
        '.cm-content': {
          fontFamily: 'var(--nb-mono-family, ui-monospace, Menlo, monospace)',
          caretColor: 'var(--nb-fg, #111827)',
        },
        '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--nb-fg, #111827)' },
        '.cm-gutters': {
          backgroundColor: 'transparent', border: 'none',
          color: 'var(--nb-muted, #cbd5e1)',
        },
        '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
        '&.cm-focused': { outline: 'none' },
        '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--nb-code-bg, rgba(0,0,0,0.08))' },
      });

      const extensions = [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        runKeymap,
        updateListener,
        blurListener,
        theme,
        EditorView.lineWrapping,
      ];
      if (langExt) extensions.push(langExt as never);

      view = new EditorView({
        state: EditorState.create({ doc: value, extensions }),
        parent: hostRef.current,
      });
      viewRef.current = view;
    })();

    return () => {
      cancelled = true;
      view?.destroy();
      viewRef.current = null;
    };
    // Rebuild only when language / fontSize change — value updates are
    // applied imperatively below to avoid losing cursor position.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, fontSize]);

  // Apply external value changes (e.g. revert, file-watcher reload)
  // without rebuilding the editor — only when they differ from the
  // current doc so user typing isn't clobbered.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="nb-cell-editor" />;
}
