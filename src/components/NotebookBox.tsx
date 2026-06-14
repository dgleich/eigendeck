// Notebook element renderer (editor mode). Wraps NotebookContent
// inside a DraggableBox with the double-click-to-interact overlay
// pattern shared with DemoBox.
//
// The notebook body lives in NotebookContent so PresentMode can
// reuse it without the editor chrome.

import { useState } from 'react';
import { DraggableBox, InteractLockBar } from './SlideElementRenderer';
import { NotebookContent } from './notebook/NotebookContent';
import {
  ElementPosition, NotebookElement, SlideElement,
} from '../types/presentation';

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
  // the pointer. Double-click overlay → interact; Lock button → back.
  const [interacting, setInteracting] = useState(false);

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
    >
      <NotebookContent element={element} interactive={interacting} />
      {!interacting && (
        <div className="nb-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {interacting && (
        <InteractLockBar scale={scale} onLock={() => setInteracting(false)} />
      )}
    </DraggableBox>
  );
}
