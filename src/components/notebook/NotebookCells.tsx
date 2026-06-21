// The notebook's cell area — header + scrollable .nb-body with the
// merged cell map (Markdown / Raw / CodeCell + the trailing "+ Cell"
// button). This is the SINGLE SOURCE OF TRUTH for how a notebook's
// cells render, shared by:
//
//   - the LIVE view (NotebookContent → ExternalKernelBody), which
//     passes a `live` controller (run buttons, editing, spinners,
//     working buffers, "+ Cell"); and
//   - the static HTML EXPORT (lib/notebookExport.tsx), which passes
//     NO `live` → outputs/exec-counts come straight from the merged
//     model, no handlers, editable=false, pointer-events:none.
//
// Because both paths render through this one component with the same
// classes, the export and the live view CANNOT drift.
//
// NOTE: the live-view branch below is the verbatim merged.map body
// that previously lived inside ExternalKernelBody. Do not restyle it —
// the live behavior is guarded by the existing notebook tests.

import React from 'react';
import { CodeCell } from './CodeCell';
import { MarkdownCell } from './MarkdownCell';
import { RawCell } from './RawCell';
import { CellOutput, CodeCell as CodeCellT } from '../../lib/notebookFormat';
import { MergedCell } from '../../lib/notebookOverlay';
import { UseOverlayResult } from '../../lib/useOverlay';

/** Transient per-cell run status (the [*] spinner) — keyed by a string
 *  cell key (index for .ipynb cells, id for appended). Not persisted;
 *  outputs themselves live in the overlay. */
export type RunningState = { running: boolean; count: number | '*' | null };

/** Live (interactive) controller. Present = live view, absent = export. */
export interface NotebookCellsLive {
  running: Map<string, RunningState>;
  working: Map<string, string>;
  editable: boolean;
  execute: (
    key: string,
    source: string,
    record: (outs: CellOutput[], count: number | null) => void,
  ) => void;
  setWorking: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  ov: UseOverlayResult;
}

export function NotebookCells({
  merged, language, highlight, dark, baseSize, showLineNumbers,
  hideHeader, kernelDisplayName, highlights, live, loading, error,
}: {
  merged: MergedCell[];
  language: string | null;
  highlight: boolean;
  dark: boolean;
  baseSize: number;
  showLineNumbers?: boolean;
  hideHeader: boolean;
  kernelDisplayName: string | null;
  /** Pre-resolved syntax highlight (export/static path), keyed by the
   *  same cell key NotebookCells uses (`i<index>` / `a<id>`). When a
   *  key is present its HTML is passed to CodeCell as highlightedHtml. */
  highlights?: Map<string, string>;
  /** Present = interactive (live view). Absent = read-only (export). */
  live?: NotebookCellsLive;
  /** Live-only status rows. */
  loading?: boolean;
  error?: Error | null;
}) {
  const interactive = live != null;
  return (
    <>
      {!hideHeader && (
        <div className="nb-header">
          <span className="nb-kernel-label">
            {kernelDisplayName}
          </span>
        </div>
      )}
      <div className="nb-body" style={{ pointerEvents: interactive ? 'auto' : 'none' }}>
        {loading && <div className="nb-status">Loading…</div>}
        {error && <div className="nb-status nb-error">Parse error: {error.message}</div>}
        {merged.map((m) => {
          if (m.origin === 'ipynb') {
            const c = m.cell;
            if (c.kind === 'markdown') return <MarkdownCell key={`i${c.index}`} cell={{ ...c, source: m.source }} />;
            if (c.kind === 'raw') return <RawCell key={`i${c.index}`} cell={{ ...c, source: m.source }} />;
            const key = `i${c.index}`;
            if (live) {
              const run = live.running.get(key);
              const wsrc = live.working.get(key);
              return (
                <CodeCell key={key}
                  cell={c as CodeCellT}
                  source={wsrc ?? m.source}
                  liveOutputs={m.outputs}
                  liveExecutionCount={run?.count ?? m.executionCount}
                  running={run?.running ?? false}
                  onRun={() => live.execute(key, live.working.get(key) ?? m.source, (o, cnt) => live.ov.recordOutput(c.index, o, cnt))}
                  language={language}
                  highlight={highlight}
                  dark={dark}
                  editable={live.editable}
                  showLineNumbers={showLineNumbers}
                  fontSize={baseSize}
                  onEdit={(next) => live.setWorking((p) => new Map(p).set(key, next))}
                  onCommit={() => { const w = live.working.get(key); if (w !== undefined) live.ov.setEdit(c.index, w, c.source); }}
                  edited={m.edited}
                  onRevert={() => { live.setWorking((p) => { const n = new Map(p); n.delete(key); return n; }); live.ov.revertEdit(c.index); }}
                />
              );
            }
            // read-only (export): outputs/exec-count from the merged model,
            // no handlers, pre-resolved highlight.
            return (
              <CodeCell key={key}
                cell={c as CodeCellT}
                source={m.source}
                liveOutputs={m.outputs}
                liveExecutionCount={m.executionCount}
                running={false}
                language={language}
                highlight={highlight}
                dark={dark}
                editable={false}
                showLineNumbers={showLineNumbers}
                fontSize={baseSize}
                highlightedHtml={highlights?.get(key)}
              />
            );
          }
          // appended cell
          const a = m.appended;
          const key = `a${a.id}`;
          if (a.cellType === 'markdown') {
            const src = live ? (live.working.get(key) ?? a.source) : a.source;
            return <MarkdownCell key={key} cell={{ kind: 'markdown', index: -1, source: src }} />;
          }
          const synth: CodeCellT = {
            kind: 'code', index: -1,
            source: a.source,
            executionCount: a.executionCount ?? null,
            outputs: a.outputs ?? [],
          };
          if (live) {
            const run = live.running.get(key);
            return (
              <CodeCell key={key}
                cell={synth}
                source={live.working.get(key) ?? a.source}
                liveOutputs={a.outputs ?? []}
                liveExecutionCount={run?.count ?? a.executionCount ?? null}
                running={run?.running ?? false}
                onRun={() => live.execute(key, live.working.get(key) ?? a.source, (o, cnt) => live.ov.recordAppendedOutput(a.id, o, cnt))}
                language={language}
                highlight={highlight}
                dark={dark}
                editable={live.editable}
                showLineNumbers={showLineNumbers}
                fontSize={baseSize}
                added
                onEdit={(next) => live.setWorking((p) => new Map(p).set(key, next))}
                onCommit={() => { const w = live.working.get(key); if (w !== undefined) live.ov.setAppendedSource(a.id, w); }}
                onRevert={() => live.ov.removeAppended(a.id)}
              />
            );
          }
          // read-only (export): appended cell, no handlers.
          return (
            <CodeCell key={key}
              cell={synth}
              source={a.source}
              liveOutputs={a.outputs ?? []}
              liveExecutionCount={a.executionCount ?? null}
              running={false}
              language={language}
              highlight={highlight}
              dark={dark}
              editable={false}
              showLineNumbers={showLineNumbers}
              fontSize={baseSize}
              added
              highlightedHtml={highlights?.get(key)}
            />
          );
        })}
        {/* "+ Cell" lives at the END of the body (not the header) so it's
            available even when the kernel header is hidden. */}
        {live && live.editable && (
          <button className="nb-add-cell" title="Add a code cell at the end"
            onClick={() => live.ov.addAppended(lastIpynbIndex(merged), 'code')}>
            + []
          </button>
        )}
      </div>
    </>
  );
}

/** Highest .ipynb cell index in the merged list, for anchoring a new
 *  appended cell at the end. null when there are no .ipynb cells. */
export function lastIpynbIndex(merged: MergedCell[]): number | null {
  let last: number | null = null;
  for (const m of merged) if (m.origin === 'ipynb') last = m.cell.index;
  return last;
}
