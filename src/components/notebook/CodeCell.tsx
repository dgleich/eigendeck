// Single code cell — source area + outputs + Run button.
//
// `liveOutputs`: when present, replaces persisted outputs (the result
// of a fresh run this session). Reverts to `cell.outputs` when null —
// e.g. after the file watcher reloads.
//
// `liveExecutionCount`: replaces the persisted `[N]` prompt;
// '*' means currently running.
//
// `language`: kernel language for syntax highlighting; null disables
// the highlighter even if `highlight` is true (no grammar to apply).
//
// Run button is disabled when `onRun` is undefined (display-only mode
// when no kernel layer is wired) or when the cell is already running.

import { useEffect, useState } from 'react';
import { CodeCell as CodeCellT, CellOutput as CellOutputT } from '../../lib/notebookFormat';
import { CellOutput } from './CellOutput';
import { highlightCode } from '../../lib/syntaxHighlight';

export interface CodeCellProps {
  cell: CodeCellT;
  liveOutputs?: CellOutputT[] | null;
  liveExecutionCount?: number | '*' | null;
  running?: boolean;
  onRun?: () => void;
  /** Kernel language (notebook.kernelspec.language). When null, no
   *  highlighting is attempted. */
  language?: string | null;
  /** Whether to highlight at all. Default true. Element-level toggle
   *  flows through here from NotebookContent. */
  highlight?: boolean;
}

export function CodeCell({
  cell, liveOutputs, liveExecutionCount, running, onRun,
  language, highlight = true,
}: CodeCellProps) {
  const outputs = liveOutputs ?? cell.outputs;
  const promptCount = running
    ? '*'
    : liveExecutionCount === '*' ? '*'
    : liveExecutionCount != null ? String(liveExecutionCount)
    : cell.executionCount != null ? String(cell.executionCount)
    : ' ';

  // Highlighted HTML — null until the lazy load resolves on first
  // mount. While null, the raw source still renders as a fallback so
  // the cell isn't blank during the brief async window.
  const [highlighted, setHighlighted] = useState<string | null>(null);
  useEffect(() => {
    if (!highlight) { setHighlighted(null); return; }
    let cancelled = false;
    highlightCode(cell.source, language ?? null).then((html) => {
      if (!cancelled) setHighlighted(html);
    });
    return () => { cancelled = true; };
  }, [cell.source, language, highlight]);

  return (
    <div className="nb-cell nb-cell-code">
      <div className={`nb-cell-prompt${running ? ' is-running' : ''}`}>[{promptCount}]</div>
      <div className="nb-cell-body">
        <div className="nb-cell-source-row">
          <pre className="nb-cell-source">
            {highlight && highlighted != null
              ? <code className="hljs" dangerouslySetInnerHTML={{ __html: highlighted }} />
              : <code>{cell.source}</code>}
          </pre>
          {onRun && (
            <button className="nb-cell-run" disabled={running}
              onClick={(e) => { e.stopPropagation(); onRun(); }}
              title="Run this cell">
              {running ? '…' : '▶'}
            </button>
          )}
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
