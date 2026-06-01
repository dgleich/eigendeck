// Notebook element renderer. Loads the .ipynb asset bytes, parses
// natively, and renders each cell with its own component. No iframe —
// the display layer is owned by eigendeck so it themes and scrolls
// like a slide.
//
// Phase 3: display-only. Code cells are static <pre>; no kernel
// connection. Phase 5 adds Run buttons + WS kernel exec.

import { useState } from 'react';
import { DraggableBox } from './SlideElementRenderer';
import { CodeCell } from './notebook/CodeCell';
import { MarkdownCell } from './notebook/MarkdownCell';
import { RawCell } from './notebook/RawCell';
import { useNotebook } from '../lib/useNotebook';
import { ElementPosition, NotebookElement, SlideElement } from '../types/presentation';

export function NotebookBox({ element, zIndex, scale, isSelected, onSelect, onDelete, onUpdate }: {
  element: NotebookElement;
  zIndex: number; scale: number;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  // `interacting` lifts the click-through overlay so scroll/click reach
  // the cell area. Same pattern as DemoBox — without it, dragging the
  // box on the canvas is impossible because the cell area would eat
  // the pointer. Double-click overlay → interact; click outside → ...
  // we leave the lock-back-out to a button to match DemoBox.
  const [interacting, setInteracting] = useState(false);
  const { notebook, error, loading } = useNotebook(element.assetId);

  // Visible cells filter — `visibleCells` whitelists by index when set.
  const cells = notebook
    ? (element.visibleCells && element.visibleCells.length > 0
        ? notebook.cells.filter((c) => element.visibleCells!.includes(c.index))
        : notebook.cells)
    : [];

  return (
    <DraggableBox
      elementId={element.id}
      position={element.position} zIndex={zIndex} scale={scale}
      className="el-notebook" isSelected={isSelected}
      linkId={element.linkId} syncId={element.syncId}
      _linkId={(element as { _linkId?: string })._linkId}
      _syncId={(element as { _syncId?: string })._syncId}
      onSelect={onSelect} onDelete={onDelete}
      onPositionChange={(pos: ElementPosition) => onUpdate({ position: pos })}
      onUpdate={onUpdate}
    >
      <div className="nb-frame">
        <div className="nb-header">
          <span className="nb-kernel-label">
            {notebook?.kernelDisplayName || notebook?.kernelspecName || 'Notebook'}
          </span>
        </div>
        <div className="nb-body" style={{ pointerEvents: interacting ? 'auto' : 'none' }}>
          {loading && <div className="nb-status">Loading…</div>}
          {error && <div className="nb-status nb-error">Parse error: {error.message}</div>}
          {notebook && cells.length === 0 && <div className="nb-status">No cells.</div>}
          {notebook && cells.map((c) => {
            switch (c.kind) {
              case 'code': return <CodeCell key={c.index} cell={c} />;
              case 'markdown': return <MarkdownCell key={c.index} cell={c} />;
              case 'raw': return <RawCell key={c.index} cell={c} />;
            }
          })}
        </div>
      </div>
      {!interacting && (
        <div className="nb-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {interacting && (
        <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 2 }}>
          <button onClick={() => setInteracting(false)}
            style={{ padding: '2px 8px', fontSize: 11, border: '1px solid #ccc',
                     borderRadius: 3, background: 'rgba(255,255,255,0.95)', cursor: 'pointer' }}>
            Lock
          </button>
        </div>
      )}
    </DraggableBox>
  );
}
