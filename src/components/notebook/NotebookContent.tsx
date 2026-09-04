// The notebook's interactive body — header + scrollable cell area
// with optional Run buttons. Used by both NotebookBox (editor,
// wrapped in DraggableBox) and PresentNotebook (PresentMode,
// wrapped in an absolute-positioned div).
//
// Display = the pristine .ipynb merged with the element's "overlay"
// (source edits, recorded outputs, live-authored appended cells) via
// mergeNotebook. The overlay is an owner-tagged asset managed by
// useOverlay — the .ipynb is never mutated. See
// .claude/notes/notebook-recording-decisions.md.
//
// `interactive: false` disables the pointer-events gate so cells
// accept clicks immediately in PresentMode.

import { useCallback, useEffect, useRef, useState } from 'react';
import './notebook.css';
import { CodeCell } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { RawCell } from './RawCell';
import { NotebookCells, RunningState } from './NotebookCells';
import { useNotebook } from '../../lib/useNotebook';
import { useOverlay } from '../../lib/useOverlay';
import { capturePreview } from '../../lib/previewCache';
import { useKernel, KernelStatus } from '../../lib/useKernel';
import { resolveNotebookKernel, ResolvedExternal } from '../../lib/notebookKernel';
import { usePreference } from '../../lib/preferences';
import { Cell, CellOutput, Notebook } from '../../lib/notebookFormat';
import {
  mergeNotebook, MergedCell, notebookSourceSignature, overlaySourceChanged,
  serializeOverlay,
} from '../../lib/notebookOverlay';
import { NotebookElement, effectiveFontSize } from '../../types/presentation';
import { usePresentationStore } from '../../store/presentation';
import { fontForNotebookProse, fontForNotebookCode } from '../../lib/notebookFonts';
import { resolveTheme, isDarkTheme, previewThemeSalt } from '../../lib/themes';

export function NotebookContent({ element, interactive, mode = 'editor' }: {
  element: NotebookElement;
  interactive: boolean;
  /** 'editor' suppresses autoRun (the inspector toggle is meaningful
   *  only in PresentMode). Defaults to 'editor'. */
  mode?: 'editor' | 'present';
}) {
  const { notebook, error, loading } = useNotebook(element.assetId);
  const config = usePresentationStore((s) => s.presentation?.config);
  const slide = usePresentationStore((s) => s.presentation?.slides?.[s.currentSlideIndex]);
  const [jupyterServers] = usePreference('jupyterServers');
  const [defaultEditable] = usePreference('defaultNotebookEditable');
  const resolved = resolveNotebookKernel(element, config, notebook, jupyterServers);

  // Effective editability cascades: element override → global pref → false.
  const editable = element.editable ?? defaultEditable;

  // BUG-2: a notebook that's EFFECTIVELY editable — whether via the per-element
  // toggle or the global default — must not be file-watched, else a disk reload
  // clobbers in-deck edits. The toggle already sets auto_reload='off'; this also
  // covers the default-on case (element.editable left undefined). Editor only,
  // so we never write during a presentation. One-directional BY DESIGN: making
  // a notebook editable stops watching, and un-editing LEAVES it stopped —
  // taking control is sticky; the user re-enables Watch explicitly (Asset
  // section) when ready. So nothing here re-enables on editable=false.
  useEffect(() => {
    if (mode !== 'editor' || !editable || !element.assetId) return;
    const assetId = element.assetId;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke('db_set_asset_auto_reload', { assetId, value: 'off' }))
      // Fire asset-changed so the file watcher re-evaluates the cascade and
      // UNSUBSCRIBES — without this the watcher keeps firing and a disk change
      // clobbers the in-deck edits despite "taking control" (matches what
      // AssetSection.setAutoReload does).
      .then(() => window.dispatchEvent(new CustomEvent('eigendeck:asset-changed', { detail: { assetId } })))
      .catch(() => {});
  }, [editable, element.assetId, mode]);

  // Typography + theme → CSS variables on the frame. (See the detailed
  // notes in the prior revision; unchanged.)
  const proseFont = fontForNotebookProse(slide, config);
  const codeFont = fontForNotebookCode(config);
  const baseSize = effectiveFontSize(element, config);
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
  const frameClass = [
    'nb-frame',
    dark ? 'nb-theme-dark' : 'nb-theme-light',
    element.showBorder ? 'nb-frame--bordered' : '',
  ].filter(Boolean).join(' ');

  // A signature that changes with the deck THEME. The preview-capture effects key
  // on element/overlay, and the theme is applied as CSS vars on .nb-frame — but a
  // theme switch doesn't change `element`, so without this term the effect never
  // re-fires and the PDF/print export bakes the STALE (old-theme) preview → wrong
  // colours on a dark slide (the live / present / HTML-export paths render fresh, so
  // only print was broken). It also feeds capturePreview's backdrop (the theme
  // background, so the rasterized PNG matches the slide) + its dedup key — the same
  // theme-salt + background a demo already passes.
  const themeSalt = previewThemeSalt(theme);

  // Cache a PNG preview of the rendered notebook so other places (the sidebar
  // mini-slide, link picker, and the PDF/print export) can show an image instead of
  // a live render. Debounced + editor-only; re-fires on element edits AND theme
  // changes. The .nb-frame target excludes the DraggableBox authoring chrome.
  useEffect(() => {
    if (mode !== 'editor') return;
    const t = setTimeout(() => { void capturePreview(element, '.nb-frame', themeSalt, theme.background); }, 700);
    return () => clearTimeout(t);
  }, [element, mode, themeSalt, theme.background]);

  const highlight = element.syntaxHighlight !== false;
  const language = notebook?.language ?? null;
  const hideHeader = element.hideHeader === true;

  // Lite backend stays display-only (no overlay/kernel) in v1.
  if (resolved.kind === 'lite') {
    return (
      <div className={frameClass} style={fontStyle}>
        <LiteKernelPlaceholder
          cells={filterCells(notebook?.cells ?? [], element)}
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
        mode={mode}
        notebook={notebook}
        loading={loading}
        error={error}
        interactive={interactive}
        editable={editable}
        resolved={resolved}
        preamble={element.preamble}
        autoRun={mode === 'present' && !!element.autoRun}
        highlight={highlight}
        dark={dark}
        language={language}
        baseSize={baseSize}
        hideHeader={hideHeader}
        kernelDisplayName={notebook?.kernelDisplayName ?? notebook?.kernelspecName ?? null}
        themeSalt={themeSalt}
        previewBg={theme.background}
      />
    </div>
  );
}

/** Apply the element's visibleCells whitelist + hideMarkdown filter to
 *  a plain Cell[] (lite path). */
function filterCells(cells: Cell[], element: NotebookElement): Cell[] {
  let out = (element.visibleCells && element.visibleCells.length > 0)
    ? cells.filter((c) => element.visibleCells!.includes(c.index))
    : cells;
  if (element.hideMarkdown) out = out.filter((c) => c.kind !== 'markdown');
  return out;
}

/** Apply the same filters to the merged render list (external path). */
export function filterMerged(merged: MergedCell[], element: NotebookElement): MergedCell[] {
  return merged.filter((m) => {
    if (m.origin === 'ipynb') {
      if (element.visibleCells && element.visibleCells.length > 0
          && !element.visibleCells.includes(m.cell.index)) return false;
      if (element.hideMarkdown && m.cell.kind === 'markdown') return false;
      return true;
    }
    // appended cells are always shown (user-authored), except markdown
    // when hideMarkdown.
    if (element.hideMarkdown && m.appended.cellType === 'markdown') return false;
    return true;
  });
}

function ExternalKernelBody({
  element, mode, notebook, loading, error, interactive, editable, resolved, preamble, autoRun,
  highlight, dark, language, baseSize, hideHeader, kernelDisplayName, themeSalt, previewBg,
}: {
  element: NotebookElement;
  mode: 'editor' | 'present';
  notebook: Notebook | null;
  loading: boolean; error: Error | null;
  interactive: boolean;
  editable: boolean;
  resolved: ResolvedExternal;
  preamble: string | undefined;
  autoRun: boolean;
  highlight: boolean;
  dark: boolean;
  language: string | null;
  baseSize: number;
  hideHeader: boolean;
  kernelDisplayName: string | null;
  themeSalt: string;
  previewBg: string;
}) {
  const kernel = useKernel(resolved);
  // Overlay identity is the element's SYNC identity, not its per-slide id:
  // synced instances (the same notebook shown on multiple slides) are the
  // SAME thing and must share ONE overlay. syncId is set to the original
  // element's id on first duplicate, so the whole group resolves here to a
  // single stable key — consistent across Save and Save As. A lone notebook
  // has no syncId and keys by its own id (unchanged).
  const ov = useOverlay(element.syncId ?? element.id);
  const updateElement = usePresentationStore((s) => s.updateElement);

  // Keep the cached PNG preview fresh when the RECORDING changes (cell edits,
  // recorded outputs, appended cells). Those live in the overlay, not the
  // element, so the element-keyed capture in NotebookContent misses them and the
  // sidebar/picker thumbnail would go stale. Debounced + editor-only; the
  // element comes via a ref so this fires only on overlay changes (the
  // NotebookContent effect already covers element/prop changes).
  const elForCapture = useRef(element);
  elForCapture.current = element;
  const ovSig = serializeOverlay(ov.overlay);
  useEffect(() => {
    if (mode !== 'editor') return;
    const t = setTimeout(() => { void capturePreview(elForCapture.current, '.nb-frame', themeSalt, previewBg); }, 700);
    return () => clearTimeout(t);
  }, [ovSig, mode, themeSalt, previewBg]);

  // Migrate legacy element.cellEdits (pre-overlay) into the overlay
  // once, then strip the field. cellEdits is being retired in favor of
  // the overlay asset.
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current) return;
    const legacy = element.cellEdits;
    if (legacy && Object.keys(legacy).length > 0) {
      migratedRef.current = true;
      for (const [k, v] of Object.entries(legacy)) {
        ov.setEdit(Number(k), v, '');   // savedSource '' → always set
      }
      updateElement(element.id, { cellEdits: undefined } as Partial<NotebookElement>);
    }
  }, [element.cellEdits, element.id, ov, updateElement]);

  // Drop the overlay ONLY when the .ipynb source genuinely changes
  // (deliberate reload-from-disk / restore-version) — detected by the
  // parsed notebook's CONTENT changing, not by the generic
  // `eigendeck:asset-changed` event. That event fires for many incidental
  // reasons (preview/cache invalidation, watcher re-eval, auto-reload
  // toggle); reacting to it wiped recorded outputs + edits during plain
  // editing. Same bytes re-parse to identical content, so a spurious event
  // is a no-op here; a real reload re-parses to different content → clear.
  const clearOverlay = ov.clear;
  const nbSigRef = useRef<{ id: string; sig: string } | null>(null);
  useEffect(() => {
    if (!notebook) return;
    const sig = notebookSourceSignature(notebook);
    const prev = nbSigRef.current;
    nbSigRef.current = { id: element.id, sig };
    if (overlaySourceChanged(prev, element.id, sig)) clearOverlay();
  }, [notebook, element.id, clearOverlay]);

  // Trust-independent "Discard Changes" (#121): the asset inspector fires this
  // to drop the run-cell overlay and re-render the notebook as stored in the
  // deck. No disk read, no trust gate (unlike Reload Now) — ov.clear() re-merges
  // against the embedded .ipynb bytes every untrusted deck already renders.
  useEffect(() => {
    if (!element.assetId) return;
    const assetId = element.assetId;
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.assetId === assetId) clearOverlay();
    };
    window.addEventListener('eigendeck:discard-overlay', handler);
    return () => window.removeEventListener('eigendeck:discard-overlay', handler);
  }, [element.assetId, clearOverlay]);

  // Transient running status, keyed by cell key.
  const [running, setRunning] = useState<Map<string, RunningState>>(new Map());
  const setRun = useCallback((key: string, s: RunningState | null) => {
    setRunning((prev) => {
      const next = new Map(prev);
      if (s === null) next.delete(key); else next.set(key, s);
      return next;
    });
  }, []);

  // Working buffers for in-progress typing, so each keystroke doesn't
  // touch the overlay state/flush. Committed to the overlay on blur.
  const [working, setWorking] = useState<Map<string, string>>(new Map());

  const preambleFiredRef = useRef(false);
  useEffect(() => { preambleFiredRef.current = false; },
    [resolved.server?.baseUrl, resolved.server?.token, resolved.kernelName]);

  // Execute `source`; stream outputs into the overlay live. `record`
  // writes the accumulating outputs (ipynb index or appended id).
  const execute = useCallback(async (
    key: string,
    source: string,
    record: (outs: CellOutput[], count: number | null) => void,
  ) => {
    setRun(key, { running: true, count: '*' });
    let outs: CellOutput[] = [];
    let count: number | null = null;
    const push = (o: CellOutput) => { outs = [...outs, o]; record(outs, count); };
    try {
      if (preamble && !preambleFiredRef.current) {
        preambleFiredRef.current = true;
        const ph = await kernel.runCell(preamble, {});
        await ph.done;
      }
      record([], null);  // clear prior outputs at run start
      const handle = await kernel.runCell(source, {
        onStream: (s) => {
          const last = outs[outs.length - 1];
          if (last && last.kind === 'stream' && last.name === s.name) {
            outs = [...outs.slice(0, -1), { ...last, text: last.text + s.text }];
            record(outs, count);
          } else { push({ kind: 'stream', ...s }); }
        },
        onDisplayData: (d) => push({ kind: 'display_data', data: d.data }),
        onExecuteResult: (r) => { count = r.executionCount; push({ kind: 'execute_result', data: r.data, executionCount: r.executionCount }); },
        onError: (e) => push({ kind: 'error', ename: e.ename, evalue: e.evalue, traceback: e.traceback }),
        // Authoritative `[N]` count — fires for every cell, including ones with
        // no output, so an assignment / print-only cell still updates its prompt.
        onReply: (r) => { if (r.executionCount != null) { count = r.executionCount; record(outs, count); } },
      });
      await handle.done;
      record(outs, count);
    } catch (e) {
      record([...outs, { kind: 'error', ename: 'KernelError', evalue: e instanceof Error ? e.message : String(e), traceback: [] }], count);
    } finally {
      setRun(key, null);
    }
  }, [kernel, preamble, setRun]);

  const merged = filterMerged(mergeNotebook(notebook, ov.overlay), element);

  // autoRun: fire all visible code cells in order (present mode).
  useEffect(() => {
    if (!autoRun) return;
    let cancelled = false;
    (async () => {
      for (const m of merged) {
        if (cancelled) break;
        if (m.origin === 'ipynb' && m.cell.kind === 'code') {
          await execute(`i${m.cell.index}`, m.source, (o, c) => ov.recordOutput(m.cell.index, o, c));
        } else if (m.origin === 'appended' && m.appended.cellType === 'code') {
          const a = m.appended;
          await execute(`a${a.id}`, a.source, (o, c) => ov.recordAppendedOutput(a.id, o, c));
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  return (
    <>
      <StatusDot status={kernel.status} />
      <NotebookCells
        merged={merged}
        language={language}
        highlight={highlight}
        dark={dark}
        baseSize={baseSize}
        showLineNumbers={element.showLineNumbers}
        hideHeader={hideHeader}
        kernelDisplayName={kernelDisplayName || resolved.kernelName}
        loading={loading}
        error={error}
        live={{ running, working, editable: editable && interactive, interactive, execute, setWorking, ov }}
      />
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

function StatusDot({ status }: { status: KernelStatus }) {
  if (status === 'idle' || status === 'disconnected') return null;
  return (
    <span className={`nb-status-dot nb-status-dot-${status}`} title={labelForStatus(status)} />
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
