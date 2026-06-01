// Raw cells render as plain monospace text — they're nbconvert's
// "passthrough" cell type (often LaTeX or HTML destined for a
// specific export). In the slide context they're rare; we show
// them as-is.

import { RawCell as RawCellT } from '../../lib/notebookFormat';

export function RawCell({ cell }: { cell: RawCellT }) {
  return (
    <div className="nb-cell nb-cell-raw">
      <div className="nb-cell-prompt" />
      <pre className="nb-cell-body nb-cell-source"><code>{cell.source}</code></pre>
    </div>
  );
}
