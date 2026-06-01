// Single code cell — source area + outputs + Run button.
//
// `liveOutputs`: when present, replaces persisted outputs (the result
// of a fresh run this session). Reverts to `cell.outputs` when null —
// e.g. after the file watcher reloads.
//
// `liveExecutionCount`: replaces the persisted `In [N]:` prompt;
// '*' means currently running.
//
// Run button is disabled when `onRun` is undefined (display-only mode
// when no kernel layer is wired) or when the cell is already running.

import { CodeCell as CodeCellT, CellOutput as CellOutputT } from '../../lib/notebookFormat';
import { CellOutput } from './CellOutput';

export interface CodeCellProps {
  cell: CodeCellT;
  liveOutputs?: CellOutputT[] | null;
  liveExecutionCount?: number | '*' | null;
  running?: boolean;
  onRun?: () => void;
}

export function CodeCell({ cell, liveOutputs, liveExecutionCount, running, onRun }: CodeCellProps) {
  const outputs = liveOutputs ?? cell.outputs;
  const promptCount = running
    ? '*'
    : liveExecutionCount === '*' ? '*'
    : liveExecutionCount != null ? String(liveExecutionCount)
    : cell.executionCount != null ? String(cell.executionCount)
    : ' ';
  return (
    <div className="nb-cell nb-cell-code">
      <div className="nb-cell-prompt">In [{promptCount}]:</div>
      <div className="nb-cell-body">
        <div className="nb-cell-source-row">
          <pre className="nb-cell-source"><code>{cell.source}</code></pre>
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
