// Single code cell — source area + outputs + Run button.
//
// `liveOutputs`: when present, replaces persisted outputs (the result
// of a fresh run this session). Reverts to `cell.outputs` when null —
// e.g. after the file watcher reloads.
//
// `liveExecutionCount`: replaces the persisted `[N]` prompt;
// '*' means currently running.
//
// `source`: the EFFECTIVE source to display + run. NotebookContent
// passes the cellEdits overlay value when one exists, else the cell's
// own source. (CodeCell never reads cell.source directly for
// display — always this prop — so edits show consistently.)
//
// `editable`: when true, the source area becomes a CodeMirror editor
// (the notebook is being interacted with). When false, a static
// highlighted <pre>.
//
// `language`: kernel language for highlighting + the editor grammar.
//
// Run button is disabled when `onRun` is undefined (display-only mode
// when no kernel layer is wired) or when the cell is already running.

import { useEffect, useState } from 'react';
import { CodeCell as CodeCellT, CellOutput as CellOutputT } from '../../lib/notebookFormat';
import { CellOutput } from './CellOutput';
import { highlightCode } from '../../lib/syntaxHighlight';
import { NotebookCellEditor } from './NotebookCellEditor';

export interface CodeCellProps {
  cell: CodeCellT;
  /** Effective source (edit overlay applied). Defaults to cell.source. */
  source?: string;
  liveOutputs?: CellOutputT[] | null;
  liveExecutionCount?: number | '*' | null;
  running?: boolean;
  onRun?: () => void;
  /** Kernel language (notebook.kernelspec.language). When null, no
   *  highlighting / grammar is applied. */
  language?: string | null;
  /** Whether to highlight at all. Default true. */
  highlight?: boolean;
  /** Dark slide theme — picks the matching editor highlight palette. */
  dark?: boolean;
  /** When true, render an editor instead of a static <pre>. */
  editable?: boolean;
  /** Show a line-number gutter in the editor. Default false (opt-in). */
  showLineNumbers?: boolean;
  /** Editor font size in slide-pixels (matches --nb-base-size). */
  fontSize?: number;
  /** Working-copy change handler (per keystroke). */
  onEdit?: (next: string) => void;
  /** Commit handler (editor blur). */
  onCommit?: () => void;
  /** True when this cell has an active edit overlay (amber accent +
   *  "edited" tag + revert ⟲). */
  edited?: boolean;
  /** True when this is a live-authored (appended) cell (teal accent +
   *  "added" tag + delete ✕). */
  added?: boolean;
  /** edited: revert to saved source. added: delete the cell. */
  onRevert?: () => void;
  /** Pre-resolved highlighted source HTML (the same markup the async
   *  highlightCode path produces). Used by the static HTML export,
   *  where the async useEffect can't run under renderToStaticMarkup.
   *  When set, it's used directly (no async highlight); when absent,
   *  the existing async behavior is unchanged. */
  highlightedHtml?: string;
}

export function CodeCell({
  cell, source, liveOutputs, liveExecutionCount, running, onRun,
  language, highlight = true, dark = false,
  editable = false, showLineNumbers = false,
  fontSize = 32, onEdit, onCommit, edited, added, onRevert,
  highlightedHtml,
}: CodeCellProps) {
  const effectiveSource = source ?? cell.source;
  // Strip ONE trailing newline for DISPLAY (static + editor) so a cell that
  // ends in "\n" doesn't render a spurious blank last line — which the
  // wrapped view hid but the line-number / no-wrap view exposes.
  const displaySource = effectiveSource.replace(/\n$/, '');
  const outputs = liveOutputs ?? cell.outputs;
  const promptCount = running
    ? '*'
    : liveExecutionCount === '*' ? '*'
    : liveExecutionCount != null ? String(liveExecutionCount)
    : cell.executionCount != null ? String(cell.executionCount)
    : ' ';

  // Highlighted HTML — null until the lazy load resolves. Recomputed
  // when the effective source changes (so edits re-highlight when the
  // cell goes back to static).
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    // A pre-resolved highlight (export path) means we don't run the async
    // highlighter — the static markup is supplied directly.
    if (highlightedHtml != null) return;
    if (!highlight || editable) { setHighlighted(null); return; }
    let cancelled = false;
    highlightCode(displaySource, language ?? null).then((html) => {
      if (!cancelled) setHighlighted(html);
    });
    return () => { cancelled = true; };
  }, [displaySource, language, highlight, editable, highlightedHtml]);

  // Effective highlighted markup: the pre-resolved prop wins (export),
  // else the async-resolved state (live).
  const effectiveHighlighted = highlightedHtml ?? highlighted;

  // Visual distinction: appended (live-authored) > edited (overlay) >
  // pristine. Drives the left accent + tag.
  const markClass = added ? ' nb-cell-added' : edited ? ' nb-cell-edited' : '';

  return (
    <div className={`nb-cell nb-cell-code${markClass}`}>
      <div className={`nb-cell-prompt${running ? ' is-running' : ''}`}>[{promptCount}]</div>
      <div className="nb-cell-body">
        <div className="nb-cell-source-row">
          {editable ? (
            <div className="nb-cell-source nb-cell-source-editing">
              <NotebookCellEditor
                value={displaySource}
                language={language ?? null}
                fontSize={fontSize}
                highlight={highlight}
                dark={dark}
                showLineNumbers={showLineNumbers}
                onChange={(next) => onEdit?.(next)}
                onRun={() => onRun?.()}
                onBlur={onCommit}
              />
            </div>
          ) : (
            <pre className={`nb-cell-source${showLineNumbers ? ' nb-has-linenos' : ''}`}>
              {showLineNumbers && (
                <span className="nb-linenos" aria-hidden="true">
                  {Array.from(
                    { length: displaySource.split('\n').length },
                    (_, i) => i + 1,
                  ).join('\n')}
                </span>
              )}
              {displaySource === ''
                /* Phantom space so an EMPTY cell still has a full line box —
                   keeps it the same height as a one-line code cell instead of
                   collapsing to padding. */
                ? <code>{' '}</code>
                : highlight && effectiveHighlighted != null
                  ? <code className="hljs" dangerouslySetInnerHTML={{ __html: effectiveHighlighted }} />
                  : <code>{displaySource}</code>}
            </pre>
          )}
          <div className="nb-cell-actions">
            {/* No text tag: the colored left accent + the action button are
                indicator enough — ⟲ revert = edited, ✕ = added. */}
            {added && onRevert && (
              <button className="nb-cell-delete"
                onClick={(e) => { e.stopPropagation(); onRevert(); }}
                title="Delete this added cell">
                ✕
              </button>
            )}
            {!added && edited && onRevert && (
              <button className="nb-cell-revert"
                onClick={(e) => { e.stopPropagation(); onRevert(); }}
                title="Revert this cell to the notebook's saved source">
                ⟲
              </button>
            )}
            {onRun && (
              <button className="nb-cell-run" disabled={running}
                onClick={(e) => { e.stopPropagation(); onRun(); }}
                title="Run this cell (Shift-Enter)">
                {running ? '…' : '▶'}
              </button>
            )}
          </div>
        </div>
        {outputs.length > 0 && (
          <div className="nb-cell-outputs">
            {outputs.map((o, i) => <CellOutput key={i} output={o} />)}
          </div>
        )}
      </div>
    </div>
  );
}
