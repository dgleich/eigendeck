// The notebook's interactive body — header + scrollable cell area
// with optional Run buttons. Used by both NotebookBox (editor,
// wrapped in DraggableBox) and PresentNotebook (PresentMode,
// wrapped in an absolute-positioned div).
//
// `interactive: false` disables the pointer-events gate so cells
// accept clicks immediately in PresentMode (the editor's overlay
// trick exists so dragging works; PresentMode has no dragging).

import { useCallback, useEffect, useRef, useState } from 'react';
import { CodeCell } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { RawCell } from './RawCell';
import { useNotebook } from '../../lib/useNotebook';
import { useKernel, KernelStatus } from '../../lib/useKernel';
import { resolveNotebookKernel, ResolvedExternal } from '../../lib/notebookKernel';
import { usePreference } from '../../lib/preferences';
import { Cell, CellOutput } from '../../lib/notebookFormat';
import { NotebookElement, effectiveFontSize } from '../../types/presentation';
import { usePresentationStore } from '../../store/presentation';
import { fontForNotebookProse, fontForNotebookCode } from '../../lib/notebookFonts';
import { resolveTheme, isDarkTheme } from '../../lib/themes';

export function NotebookContent({ element, interactive, mode = 'editor' }: {
  element: NotebookElement;
  interactive: boolean;
  /** 'editor' suppresses autoRun (the inspector toggle is meaningful
   *  only in PresentMode). Defaults to 'editor' so the editor can
   *  omit the prop. */
  mode?: 'editor' | 'present';
}) {
  const { notebook, error, loading } = useNotebook(element.assetId);
  const config = usePresentationStore((s) => s.presentation?.config);
  const slide = usePresentationStore((s) => s.presentation?.slides?.[s.currentSlideIndex]);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const [jupyterServers] = usePreference('jupyterServers');
  const [defaultEditable] = usePreference('defaultNotebookEditable');
  const resolved = resolveNotebookKernel(element, config, notebook, jupyterServers);

  // Effective editability cascades: element override → global pref →
  // false. (Per DESIGN_DECISIONS.md "Preferences cascade".)
  const editable = element.editable ?? defaultEditable;

  // A manual reload-from-disk (or restore) fires `asset-changed` for
  // this asset. When that happens we drop the in-deck cellEdits
  // overlay — the user explicitly asked for fresh source, so the
  // overlay should no longer mask it. Auto-reload can't fire here when
  // the notebook is editable (editing turns watching off), so this
  // only triggers on a deliberate reload.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { assetId?: string } | undefined;
      if (detail?.assetId !== element.assetId) return;
      if (element.cellEdits && Object.keys(element.cellEdits).length > 0) {
        updateElement(element.id, { cellEdits: undefined } as Partial<NotebookElement>);
      }
    };
    window.addEventListener('eigendeck:asset-changed', handler);
    return () => window.removeEventListener('eigendeck:asset-changed', handler);
  }, [element.assetId, element.id, element.cellEdits, updateElement]);

  // Typography resolution. CSS variables flow through to .nb-* rules
  // via inline style on the frame wrapper below — keeps the CSS file
  // generic while the per-element resolution stays in TS.
  // --nb-base-size is the code-source size in slide-pixels; other
  // text (markdown, outputs, prompts) is sized proportionally to it
  // via CSS calc() so the visual hierarchy stays consistent across
  // size presets.
  const proseFont = fontForNotebookProse(slide, config);
  const codeFont = fontForNotebookCode(config);
  // Resolution priority: explicit numeric override (fontSize) wins,
  // then the named size walked through the deck's type scale, then
  // the 'note' default (32 px). See DESIGN_DECISIONS.md "Preferences
  // cascade" — default-setting flavor.
  const baseSize = effectiveFontSize(element, config);

  // Theme-awareness: derive notebook colors from the slide's resolved
  // theme so the notebook integrates with light/dark/custom themes
  // instead of being a hardcoded white card. CSS variables flow to the
  // scoped .nb-* rules; a `nb-theme-dark` class swaps the syntax-
  // highlight palette. Code-cell + output backgrounds are a subtle
  // tint OVER the slide background (translucent black on light themes,
  // translucent white on dark) so they read as "code regions" without
  // hardcoding a grey.
  const theme = resolveTheme(
    usePresentationStore.getState().presentation?.theme ?? 'white',
    slide?.theme,
  );
  const dark = isDarkTheme(theme);
  const tint = dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.045)';
  const borderColor = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.12)';
  const fontStyle: React.CSSProperties = {
    '--nb-prose-family': proseFont.family,
    '--nb-mono-family': codeFont.family,
    '--nb-base-size': `${baseSize}px`,
    '--nb-fg': theme.text,
    '--nb-bg': theme.background,
    '--nb-code-bg': tint,
    '--nb-muted': theme.muted,
    '--nb-accent': theme.accent,
    '--nb-border': borderColor,
  } as React.CSSProperties;

  // Frame classes: theme palette + optional border. Default is
  // borderless (blends into the slide).
  const frameClass = [
    'nb-frame',
    dark ? 'nb-theme-dark' : 'nb-theme-light',
    element.showBorder ? 'nb-frame--bordered' : '',
  ].filter(Boolean).join(' ');

  let cells: Cell[] = notebook
    ? (element.visibleCells && element.visibleCells.length > 0
        ? notebook.cells.filter((c) => element.visibleCells!.includes(c.index))
        : notebook.cells)
    : [];
  // hideMarkdown → drop markdown cells, keep code (+ raw). "Focus on
  // the code" mode.
  if (element.hideMarkdown) {
    cells = cells.filter((c) => c.kind !== 'markdown');
  }

  // Syntax-highlight settings flow into the cell components.
  // `highlight` defaults to true; the element-level toggle disables.
  // `language` is read from the parsed notebook's kernelspec.
  const highlight = element.syntaxHighlight !== false;
  const language = notebook?.language ?? null;
  const hideHeader = element.hideHeader === true;

  if (resolved.kind === 'lite') {
    return (
      <div className={frameClass} style={fontStyle}>
        <LiteKernelPlaceholder
          cells={cells}
          interactive={interactive}
          highlight={highlight}
          language={language}
          hideHeader={hideHeader}
          kernelDisplayName={notebook?.kernelDisplayName ?? notebook?.kernelspecName ?? null}
        />
      </div>
    );
  }
  return (
    <div className={frameClass} style={fontStyle}>
      <ExternalKernelBody
        element={element}
        cells={cells}
        loading={loading}
        error={error}
        interactive={interactive}
        editable={editable}
        resolved={resolved}
        preamble={element.preamble}
        autoRun={mode === 'present' && !!element.autoRun}
        highlight={highlight}
        language={language}
        baseSize={baseSize}
        hideHeader={hideHeader}
        kernelDisplayName={notebook?.kernelDisplayName ?? notebook?.kernelspecName ?? null}
      />
    </div>
  );
}

interface CellRunState {
  outputs: CellOutput[];
  executionCount: number | '*' | null;
  running: boolean;
}

function ExternalKernelBody({
  element, cells, loading, error, interactive, editable, resolved, preamble, autoRun,
  highlight, language, baseSize, hideHeader, kernelDisplayName,
}: {
  element: NotebookElement;
  cells: Cell[];
  loading: boolean; error: Error | null;
  interactive: boolean;
  editable: boolean;
  resolved: ResolvedExternal;
  preamble: string | undefined;
  autoRun: boolean;
  highlight: boolean;
  language: string | null;
  baseSize: number;
  hideHeader: boolean;
  kernelDisplayName: string | null;
}) {
  const kernel = useKernel(resolved);
  const updateElement = usePresentationStore((s) => s.updateElement);
  const [runState, setRunState] = useState<Map<number, CellRunState>>(new Map());
  const accRef = useRef(runState);
  accRef.current = runState;

  // --- Cell-source edit overlay ------------------------------------
  // `working` holds the live-typing copy keyed by cell index; seeded
  // from the persisted element.cellEdits. We keep typing in local
  // state (not the store) so each keystroke doesn't spam undo / the
  // SQLite write-through; commits land on blur (commitEdit).
  const persistedEdits = element.cellEdits;
  const [working, setWorking] = useState<Map<number, string>>(
    () => new Map(Object.entries(persistedEdits ?? {}).map(([k, v]) => [Number(k), v]))
  );
  // Re-seed when the persisted overlay changes by identity (e.g. undo,
  // file reload). Cheap — cellEdits is small.
  useEffect(() => {
    setWorking(new Map(Object.entries(persistedEdits ?? {}).map(([k, v]) => [Number(k), v])));
  }, [persistedEdits]);

  /** Effective source for a cell: working overlay if present, else
   *  the cell's own (parsed) source. */
  const sourceFor = useCallback((c: Cell): string => {
    if (c.kind !== 'code') return c.source;
    const w = working.get(c.index);
    return w !== undefined ? w : c.source;
  }, [working]);

  const onEdit = useCallback((index: number, next: string) => {
    setWorking((prev) => { const m = new Map(prev); m.set(index, next); return m; });
  }, []);

  /** Commit the working copy for one cell into element.cellEdits.
   *  If the edit equals the cell's saved source, drop the overlay
   *  entry (a no-op edit shouldn't leave a phantom override). */
  const commitEdit = useCallback((index: number, savedSource: string) => {
    const w = working.get(index);
    const nextEdits: Record<number, string> = { ...(element.cellEdits ?? {}) };
    if (w === undefined || w === savedSource) {
      delete nextEdits[index];
    } else {
      nextEdits[index] = w;
    }
    const isEmpty = Object.keys(nextEdits).length === 0;
    updateElement(element.id, {
      cellEdits: isEmpty ? undefined : nextEdits,
    } as Partial<NotebookElement>);
  }, [working, element.cellEdits, element.id, updateElement]);

  const revertEdit = useCallback((index: number) => {
    setWorking((prev) => { const m = new Map(prev); m.delete(index); return m; });
    const nextEdits: Record<number, string> = { ...(element.cellEdits ?? {}) };
    delete nextEdits[index];
    const isEmpty = Object.keys(nextEdits).length === 0;
    updateElement(element.id, {
      cellEdits: isEmpty ? undefined : nextEdits,
    } as Partial<NotebookElement>);
  }, [element.cellEdits, element.id, updateElement]);
  // Track whether preamble has fired in the current kernel session.
  // Reset to false whenever the kernel reconnects (which happens on
  // server / kernelName change — see useKernel's effect dep).
  const preambleFiredRef = useRef(false);
  useEffect(() => { preambleFiredRef.current = false; },
    [resolved.server?.baseUrl, resolved.server?.token, resolved.kernelName]);

  const setCellState = useCallback(
    (index: number, patch: Partial<CellRunState> | ((prev: CellRunState | undefined) => CellRunState)) => {
      setRunState((prev) => {
        const next = new Map(prev);
        const old = next.get(index);
        const updated = typeof patch === 'function'
          ? patch(old)
          : { outputs: old?.outputs ?? [], executionCount: old?.executionCount ?? null, running: old?.running ?? false, ...patch };
        next.set(index, updated);
        accRef.current = next;
        return next;
      });
    },
    []
  );

  const runOne = useCallback(async (index: number, source: string) => {
    setCellState(index, { outputs: [], executionCount: '*', running: true });
    try {
      // Preamble fires once per kernel session, BEFORE the first cell.
      // Silent execute (no callbacks wired) — its outputs aren't user-
      // facing; only its side effects on the kernel namespace are.
      if (preamble && !preambleFiredRef.current) {
        preambleFiredRef.current = true;
        const ph = await kernel.runCell(preamble, {});
        await ph.done;
      }
      const handle = await kernel.runCell(source, {
        onStream: (s) => setCellState(index, (prev) => {
          const outs = prev?.outputs ? [...prev.outputs] : [];
          const last = outs[outs.length - 1];
          if (last && last.kind === 'stream' && last.name === s.name) {
            outs[outs.length - 1] = { ...last, text: last.text + s.text };
          } else {
            outs.push({ kind: 'stream', ...s });
          }
          return { outputs: outs, executionCount: prev?.executionCount ?? '*', running: true };
        }),
        onDisplayData: (d) => setCellState(index, (prev) => ({
          outputs: [...(prev?.outputs ?? []), { kind: 'display_data', data: d.data }],
          executionCount: prev?.executionCount ?? '*', running: true,
        })),
        onExecuteResult: (r) => setCellState(index, (prev) => ({
          outputs: [...(prev?.outputs ?? []), { kind: 'execute_result', data: r.data, executionCount: r.executionCount }],
          executionCount: r.executionCount ?? prev?.executionCount ?? '*',
          running: true,
        })),
        onError: (e) => setCellState(index, (prev) => ({
          outputs: [...(prev?.outputs ?? []), { kind: 'error', ename: e.ename, evalue: e.evalue, traceback: e.traceback }],
          executionCount: prev?.executionCount ?? '*', running: true,
        })),
      });
      await handle.done;
    } catch (e) {
      setCellState(index, (prev) => ({
        outputs: [
          ...(prev?.outputs ?? []),
          { kind: 'error', ename: 'KernelError', evalue: e instanceof Error ? e.message : String(e), traceback: [] },
        ],
        executionCount: prev?.executionCount ?? null,
        running: false,
      }));
    } finally {
      setCellState(index, (prev) => ({
        outputs: prev?.outputs ?? [],
        executionCount: prev?.executionCount ?? null,
        running: false,
      }));
    }
  }, [kernel, setCellState, preamble]);

  // autoRun: when active in PresentMode and the element has autoRun
  // set, fire all visible code cells in order on mount. Each call
  // waits for the previous to finish so output ordering matches the
  // notebook's natural top-to-bottom flow.
  useEffect(() => {
    if (!autoRun) return;
    let cancelled = false;
    (async () => {
      for (const c of cells) {
        if (cancelled) break;
        if (c.kind !== 'code') continue;
        await runOne(c.index, sourceFor(c));
      }
    })();
    return () => { cancelled = true; };
    // Intentionally only depends on autoRun + element identity (cells
    // ref changes on every parse; we don't want to retrigger).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <>
      {/* Busy indicator: a small dot at the top-left of the frame,
          present regardless of the header. Visible only for states
          worth a glance mid-talk (connecting / busy / error / dead /
          no-server); idle + disconnected render nothing. This is the
          ONLY status cue when the header is hidden. */}
      <StatusDot status={kernel.status} />
      {!hideHeader && (
        <div className="nb-header">
          <span className="nb-kernel-label">
            {kernelDisplayName || resolved.kernelName}
          </span>
        </div>
      )}
      <div className="nb-body" style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
        {loading && <div className="nb-status">Loading…</div>}
        {error && <div className="nb-status nb-error">Parse error: {error.message}</div>}
        {cells.map((c) => {
          switch (c.kind) {
            case 'code': {
              const st = runState.get(c.index);
              const src = sourceFor(c);
              return (
                <CodeCell key={c.index} cell={c}
                  source={src}
                  liveOutputs={st?.outputs ?? null}
                  liveExecutionCount={st?.executionCount ?? null}
                  running={st?.running ?? false}
                  onRun={() => runOne(c.index, sourceFor(c))}
                  language={language}
                  highlight={highlight}
                  editable={editable && interactive}
                  fontSize={baseSize}
                  onEdit={(next) => onEdit(c.index, next)}
                  onCommit={() => commitEdit(c.index, c.source)}
                  edited={src !== c.source}
                  onRevert={() => revertEdit(c.index)}
                />
              );
            }
            case 'markdown': return <MarkdownCell key={c.index} cell={c} />;
            case 'raw': return <RawCell key={c.index} cell={c} />;
          }
        })}
      </div>
    </>
  );
}

/** Human-readable status, used only as the dot's hover title. */
function labelForStatus(s: KernelStatus): string {
  switch (s) {
    case 'disconnected': return 'not connected';
    case 'connecting': return 'connecting…';
    case 'idle': return 'idle';
    case 'busy': return 'running';
    case 'error': return 'error';
    case 'dead': return 'kernel died';
    case 'no-server': return 'no matching server';
  }
}

/** Small top-left status dot. Renders nothing for idle/disconnected
 *  (no clutter when there's nothing to say); a colored dot otherwise.
 *  busy pulses. */
function StatusDot({ status }: { status: KernelStatus }) {
  if (status === 'idle' || status === 'disconnected') return null;
  return (
    <span
      className={`nb-status-dot nb-status-dot-${status}`}
      title={labelForStatus(status)}
    />
  );
}

function LiteKernelPlaceholder({
  cells, interactive, highlight, language, hideHeader, kernelDisplayName,
}: {
  cells: Cell[];
  interactive: boolean;
  highlight: boolean;
  language: string | null;
  hideHeader: boolean;
  kernelDisplayName: string | null;
}) {
  return (
    <>
      {!hideHeader && (
        <div className="nb-header">
          <span className="nb-kernel-label">{kernelDisplayName || 'Notebook'}</span>
          <span className="nb-lite-tag">lite</span>
        </div>
      )}
      <div className="nb-body" style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
        {cells.map((c) => {
          switch (c.kind) {
            case 'code': return <CodeCell key={c.index} cell={c}
              language={language} highlight={highlight} />;
            case 'markdown': return <MarkdownCell key={c.index} cell={c} />;
            case 'raw': return <RawCell key={c.index} cell={c} />;
          }
        })}
      </div>
    </>
  );
}
