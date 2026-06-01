// Single code cell — source area + outputs. Phase 3 renders source
// as a static <pre>; Phase 8 swaps that for CodeMirror with the
// notebook's language pack.
//
// The `In [N]:` prompt mirrors Jupyter Lab conventions. null prompt
// (cell never run) renders as `In [ ]:`.

import { CodeCell as CodeCellT } from '../../lib/notebookFormat';
import { CellOutput } from './CellOutput';

export function CodeCell({ cell }: { cell: CodeCellT }) {
  const prompt = cell.executionCount === null ? ' ' : String(cell.executionCount);
  return (
    <div className="nb-cell nb-cell-code">
      <div className="nb-cell-prompt">In [{prompt}]:</div>
      <div className="nb-cell-body">
        <pre className="nb-cell-source"><code>{cell.source}</code></pre>
        {cell.outputs.length > 0 && (
          <div className="nb-cell-outputs">
            {cell.outputs.map((o, i) => <CellOutput key={i} output={o} />)}
          </div>
        )}
      </div>
    </div>
  );
}
