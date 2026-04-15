import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore, pauseUndo, resumeUndo } from '../store/presentation';
import { TEXT_PRESET_STYLES } from '../types/presentation';
import { TextFormatToolbar } from './TextFormatToolbar';
import { typesetElement, resetMathElement, containsMath, getDisplayMathHeight } from '../lib/mathjax';
import type { SlideElement, ElementPosition, TextElement } from '../types/presentation';

interface Props {
  element: SlideElement;
  zIndex: number;
  scale: number;
  projectPath: string | null;
  isSelected: boolean;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void;
  onSelect: (e?: { shiftKey: boolean }) => void;
}

export function SlideElementRenderer({
  element, zIndex, scale, projectPath, isSelected, onUpdate, onDelete, onSelect,
}: Props) {
  switch (element.type) {
    case 'text':
      return (
        <DraggableBox
          elementId={element.id}
          position={element.position} zIndex={zIndex} scale={scale}
          className={`el-text el-preset-${element.preset}`}
          isSelected={isSelected}
          linkId={element.linkId} syncId={element.syncId}
          _linkId={(element as any)._linkId} _syncId={(element as any)._syncId}
          dataValign={element.verticalAlign || (element.preset === 'title' || element.preset === 'footnote' ? 'bottom' : undefined)}
          onEdit={() => {
            // Trigger edit mode on the TextContent inside this box
            const el = document.querySelector(`[data-element-id="${element.id}"]`);
            if (el) el.dispatchEvent(new CustomEvent('start-editing', { bubbles: false }));
          }}
          onSelect={onSelect} onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
          onUpdate={onUpdate}
        >
          <TextContent element={element} onCommit={(html) => onUpdate({ html } as any)} />
        </DraggableBox>
      );

    case 'image': {
      let src: string;
      if (element.src.startsWith('data:')) src = element.src;
      else if (projectPath) {
        try { src = convertFileSrc(`${projectPath}/${element.src}`); }
        catch { src = element.src; }
      } else src = element.src;
      return (
        <DraggableBox
          elementId={element.id}
          position={element.position} zIndex={zIndex} scale={scale}
          className="el-image" isSelected={isSelected}
          linkId={element.linkId} syncId={element.syncId}
          _linkId={(element as any)._linkId} _syncId={(element as any)._syncId}
          onSelect={onSelect} onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
          onUpdate={onUpdate}
        >
          <img src={src} alt="" draggable={false}
            style={{
              width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none',
              ...(element.shadow ? { filter: 'drop-shadow(4px 8px 16px rgba(0,0,0,0.3))' } : {}),
              ...(element.borderRadius ? { borderRadius: element.borderRadius } : {}),
              ...(element.opacity != null && element.opacity < 1 ? { opacity: element.opacity } : {}),
              ...(element.rotation ? { transform: `rotate(${element.rotation}deg)` } : {}),
            }} />
        </DraggableBox>
      );
    }

    case 'demo':
      return (
        <DemoBox
          element={element} zIndex={zIndex} scale={scale}
          projectPath={projectPath} isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate}
        />
      );

    case 'demo-piece':
      return (
        <DemoPieceBox
          element={element} zIndex={zIndex} scale={scale}
          projectPath={projectPath} isSelected={isSelected}
          onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate}
        />
      );

    case 'cover':
      return (
        <DraggableBox
          elementId={element.id}
          position={element.position} zIndex={zIndex} scale={scale}
          className="el-cover" isSelected={isSelected}
          linkId={element.linkId} syncId={element.syncId}
          _linkId={(element as any)._linkId} _syncId={(element as any)._syncId}
          onSelect={onSelect} onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
          onUpdate={onUpdate}
        >
          <div style={{
            width: '100%', height: '100%',
            background: element.color || '#ffffff',
            pointerEvents: 'none',
          }} />
        </DraggableBox>
      );

    case 'arrow':
      return (
        <ArrowRenderer element={element} zIndex={zIndex} scale={scale}
          isSelected={isSelected}
          onUpdate={onUpdate} onDelete={onDelete} onSelect={onSelect} />
      );
  }
}

// ============================================
// Demo element with overlay for dragging
// ============================================
function DemoBox({ element, zIndex, scale, projectPath, isSelected, onSelect, onDelete, onUpdate }: {
  element: Extract<SlideElement, { type: 'demo' }>;
  zIndex: number; scale: number; projectPath: string | null;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const [interacting, setInteracting] = useState(false);
  let src: string | undefined;
  if (projectPath) {
    try { src = convertFileSrc(`${projectPath}/${element.src}`); }
    catch { src = undefined; }
  }
  return (
    <DraggableBox
      elementId={element.id}
      position={element.position} zIndex={zIndex} scale={scale}
      className="el-demo" isSelected={isSelected}
      linkId={element.linkId} syncId={element.syncId}
      _linkId={(element as any)._linkId} _syncId={(element as any)._syncId}
      onSelect={onSelect} onDelete={onDelete}
      onPositionChange={(pos) => onUpdate({ position: pos } as any)}
      onUpdate={onUpdate}
    >
      {src ? (
        <iframe src={src} sandbox="allow-scripts allow-same-origin" title="demo"
          style={{ width: '100%', height: '100%', border: 'none', pointerEvents: interacting ? 'auto' : 'none' }} />
      ) : <div style={{ padding: 20, color: '#999' }}>Demo: {element.src}</div>}
      {!interacting && (
        <div className="demo-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {interacting && (
        <button className="demo-lock-btn" onClick={() => setInteracting(false)}
          style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, padding: '2px 8px', fontSize: 11,
            border: '1px solid #ccc', borderRadius: 3, background: 'rgba(255,255,255,0.9)', cursor: 'pointer' }}>
          Lock
        </button>
      )}
    </DraggableBox>
  );
}

// ============================================
// Demo-piece element — viewport iframe with piece hash
// ============================================
function DemoPieceBox({ element, zIndex, scale, projectPath, isSelected, onSelect, onDelete, onUpdate }: {
  element: Extract<SlideElement, { type: 'demo-piece' }>;
  zIndex: number; scale: number; projectPath: string | null;
  isSelected: boolean;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const [interacting, setInteracting] = useState(false);
  let src: string | undefined;
  if (projectPath) {
    try { src = convertFileSrc(`${projectPath}/${element.demoSrc}`) + `#piece=${element.piece}`; }
    catch { src = undefined; }
  }
  return (
    <DraggableBox
      elementId={element.id}
      position={element.position} zIndex={zIndex} scale={scale}
      className="el-demo el-demo-piece" isSelected={isSelected}
      linkId={element.linkId} syncId={element.syncId}
      _linkId={(element as any)._linkId} _syncId={(element as any)._syncId}
      onSelect={onSelect} onDelete={onDelete}
      onPositionChange={(pos) => onUpdate({ position: pos } as any)}
      onUpdate={onUpdate}
    >
      {src ? (
        <iframe src={src} sandbox="allow-scripts allow-same-origin" title={`demo-piece: ${element.piece}`}
          style={{ width: '100%', height: '100%', border: 'none', pointerEvents: interacting ? 'auto' : 'none' }} />
      ) : <div style={{ padding: 20, color: '#999' }}>Demo piece: {element.demoSrc} #{element.piece}</div>}
      {!interacting && (
        <div className="demo-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, cursor: 'grab', zIndex: 1 }} />
      )}
      {interacting && (
        <button className="demo-lock-btn" onClick={() => setInteracting(false)}
          style={{ position: 'absolute', top: 4, right: 4, zIndex: 2, padding: '2px 8px', fontSize: 11,
            border: '1px solid #ccc', borderRadius: 3, background: 'rgba(255,255,255,0.9)', cursor: 'pointer' }}>
          Lock
        </button>
      )}
    </DraggableBox>
  );
}

// ============================================
// Text content — built from the working MinimalText approach
// ============================================
function TextContent({
  element,
  onCommit,
}: {
  element: TextElement;
  onCommit: (html: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [toolbarPos, setToolbarPos] = useState({ top: 0, left: 0, width: 0 });

  const presetStyle = TEXT_PRESET_STYLES[element.preset];
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    fontFamily: element.fontFamily || presetStyle.fontFamily,
    fontSize: element.fontSize || presetStyle.fontSize,
    fontWeight: presetStyle.fontWeight,
    fontStyle: presetStyle.fontStyle,
    color: element.color || presetStyle.color,
    lineHeight: 1.3,
    padding: '8px 12px',
    outline: 'none',
    overflow: 'hidden',
    cursor: editing ? 'text' : 'inherit',
  };

  // Display mode: set innerHTML and typeset math
  const mathPreamble = usePresentationStore((s) => s.presentation.config.mathPreamble);
  useEffect(() => {
    if (ref.current && !editing) {
      resetMathElement(ref.current, element.html);
      if (containsMath(element.html)) {
        typesetElement(ref.current, mathPreamble);
      }
    }
  }, [element.html, editing, mathPreamble]);

  // Listen for 'start-editing' custom event from context menu
  useEffect(() => {
    const el = wrapperRef.current?.closest('[data-element-id]');
    if (!el) return;
    const handler = () => { if (!editing) startEditing(); };
    el.addEventListener('start-editing', handler);
    return () => el.removeEventListener('start-editing', handler);
  });

  // Position toolbar
  useEffect(() => {
    if (editing && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setToolbarPos({ top: rect.top - 46, left: rect.left, width: rect.width });
    }
  }, [editing]);

  // $$ line nowrap helpers
  const extractDisplayTex = (text: string): string | null => {
    const match = text.trim().match(/^\$\$([\s\S]*?)\$\$/);
    return match ? match[1] : null;
  };

  const applyMathLineStyles = (el: HTMLElement) => {
    const applyToNode = (node: HTMLElement) => {
      const text = node.textContent || '';
      if (text.trimStart().startsWith('$$')) {
        node.style.whiteSpace = 'nowrap';
        node.style.overflowX = 'auto';
        const tex = extractDisplayTex(text);
        if (tex) {
          const cachedHeight = getDisplayMathHeight(tex);
          if (cachedHeight) {
            node.style.minHeight = cachedHeight;
            node.style.lineHeight = 'normal';
            node.style.display = 'flex';
            node.style.alignItems = 'center';
          }
        }
      } else {
        node.style.whiteSpace = '';
        node.style.overflowX = '';
        node.style.minHeight = '';
        node.style.lineHeight = '';
        node.style.display = '';
        node.style.alignItems = '';
      }
    };
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) applyToNode(child as HTMLElement);
    }
    if (el.childNodes.length <= 1 && (el.textContent || '').trimStart().startsWith('$$')) {
      applyToNode(el);
    }
    // NOTE: don't clear styles on the root el — that overwrites React's lineHeight: 1.3
  };

  const stripMathLineStyles = (el: HTMLElement) => {
    // Only strip styles from child elements, not the root (which has React-managed styles)
    for (const child of Array.from(el.querySelectorAll('*'))) {
      const c = child as HTMLElement;
      if (c.style.whiteSpace === 'nowrap') c.style.whiteSpace = '';
      if (c.style.overflowX === 'auto') c.style.overflowX = '';
      if (c.style.minHeight) c.style.minHeight = '';
      if (c.style.lineHeight === 'normal') c.style.lineHeight = '';
      if (c.style.display === 'flex') c.style.display = '';
      if (c.style.alignItems) c.style.alignItems = '';
    }
  };

  const startEditing = () => {
    setEditing(true);
    setTimeout(() => {
      if (ref.current) {
        ref.current.innerHTML = element.html;
        applyMathLineStyles(ref.current);
        ref.current.focus();
        requestAnimationFrame(() => {
          if (ref.current) applyMathLineStyles(ref.current);
        });
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(ref.current);
          sel.collapseToEnd();
        }
      }
    }, 0);
  };

  const commitAndClose = useCallback(() => {
    if (ref.current) {
      stripMathLineStyles(ref.current);
      onCommit(ref.current.innerHTML);
    }
    setEditing(false);
  }, [onCommit]);

  // Close editing when clicking outside this element
  useEffect(() => {
    if (!editing) return;
    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      // Stay open if clicking within our element or the toolbar
      if (wrapperRef.current?.contains(target)) return;
      if (target.closest('.text-format-toolbar')) return;
      commitAndClose();
    };
    // Use capture so we see the event before stopPropagation in other handlers
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, [editing, commitAndClose]);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
      {editing && createPortal(
        <div style={{
          position: 'fixed', top: toolbarPos.top, left: toolbarPos.left,
          width: Math.max(toolbarPos.width, 500), zIndex: 9999,
        }}>
          <TextFormatToolbar onClose={commitAndClose} />
        </div>,
        document.body
      )}
      <div
        ref={ref}
        style={style}
        contentEditable={editing}
        suppressContentEditableWarning
        onDoubleClick={() => { if (!editing) startEditing(); }}
        onBlur={editing ? (e) => {
          const related = e.relatedTarget as HTMLElement | null;
          if (related?.closest('.text-format-toolbar')) return;
          setTimeout(() => {
            if (!document.activeElement?.closest('.text-format-toolbar')) commitAndClose();
          }, 100);
        } : undefined}
        onInput={editing ? () => {
          if (ref.current) applyMathLineStyles(ref.current);
        } : undefined}
        onKeyDown={editing ? (e) => {
          if (e.key === 'Escape') commitAndClose();
          e.stopPropagation();
        } : undefined}
      />
    </div>
  );
}

// ============================================
// Draggable + resizable box
// ============================================
function DraggableBox({
  elementId, position: pos, zIndex, scale, className, children, isSelected,
  linkId, syncId, _linkId, _syncId, dataValign, onEdit,
  onSelect, onDelete, onPositionChange, onUpdate,
}: {
  elementId: string;
  position: ElementPosition; zIndex: number; scale: number; className: string;
  children: React.ReactNode; isSelected: boolean;
  linkId?: string; syncId?: string; _linkId?: string; _syncId?: string;
  dataValign?: string;
  onEdit?: () => void;
  onSelect: (e?: { shiftKey: boolean }) => void; onDelete: () => void;
  onPositionChange: (pos: ElementPosition) => void;
  onUpdate: (changes: Partial<SlideElement>) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });
  const lastDelta = useRef({ dx: 0, dy: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.el-resize-handle, .el-delete-btn, [contenteditable="true"]')) return;
      e.preventDefault(); e.stopPropagation();

      // Shift+click toggles selection without starting drag
      if (e.shiftKey) {
        onSelect({ shiftKey: true });
        return;
      }

      // If not already selected, select it (clears multi-select)
      if (!isSelected) onSelect();

      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };
      lastDelta.current = { dx: 0, dy: 0 };
      // Lazy: only start drag state and blocker on first actual movement
      let dragStarted = false;
      let blocker: HTMLDivElement | null = null;
      const ensureDragStarted = () => {
        if (!dragStarted) {
          dragStarted = true;
          setIsDragging(true);
          pauseUndo();
          blocker = document.createElement('div');
          blocker.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:grabbing;';
          document.body.appendChild(blocker);
        }
      };

      // Check if we're part of a multi-selection for group drag
      const sel = usePresentationStore.getState().selectedObject;
      const useMultiDrag = isSelected && sel?.type === 'multi' && sel.ids.includes(elementId);

      if (useMultiDrag && sel?.type === 'multi') {
        const ids = sel.ids;
        const handleMove = (me: PointerEvent) => {
          ensureDragStarted();
          let dx = Math.round((me.clientX - dragStart.current.x) / scale);
          let dy = Math.round((me.clientY - dragStart.current.y) / scale);
          // Shift constrains to horizontal or vertical
          if (me.shiftKey) {
            if (Math.abs(dx) > Math.abs(dy)) dy = 0;
            else dx = 0;
          }
          const ddx = dx - lastDelta.current.dx;
          const ddy = dy - lastDelta.current.dy;
          if (ddx !== 0 || ddy !== 0) {
            usePresentationStore.getState().moveElementsBy(ids, ddx, ddy);
            lastDelta.current = { dx, dy };
          }
        };
        const handleUp = () => {
          blocker?.remove();
          if (dragStarted) { setIsDragging(false); resumeUndo(); }
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
        };
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
      } else {
        const handleMove = (me: PointerEvent) => {
          ensureDragStarted();
          let newX = Math.round(dragStart.current.posX + (me.clientX - dragStart.current.x) / scale);
          let newY = Math.round(dragStart.current.posY + (me.clientY - dragStart.current.y) / scale);
          // Shift constrains to horizontal or vertical
          if (me.shiftKey) {
            const dx = Math.abs(newX - dragStart.current.posX);
            const dy = Math.abs(newY - dragStart.current.posY);
            if (dx > dy) newY = dragStart.current.posY;
            else newX = dragStart.current.posX;
          }
          onPositionChange({ ...pos, x: newX, y: newY });
        };
        const handleUp = () => {
          blocker?.remove();
          if (dragStarted) { setIsDragging(false); resumeUndo(); }
          window.removeEventListener('pointermove', handleMove);
          window.removeEventListener('pointerup', handleUp);
        };
        window.addEventListener('pointermove', handleMove);
        window.addEventListener('pointerup', handleUp);
      }
    },
    [elementId, pos, scale, isSelected, onSelect, onPositionChange]
  );

  const handleResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation(); pauseUndo();
      resizeStart.current = { x: e.clientX, y: e.clientY, w: pos.width, h: pos.height };
      // Block iframes from stealing pointer events during resize
      const blocker = document.createElement('div');
      blocker.style.cssText = 'position:fixed;inset:0;z-index:99999;cursor:nwse-resize;';
      document.body.appendChild(blocker);
      const handleMove = (me: PointerEvent) => {
        onPositionChange({
          ...pos,
          width: Math.max(50, Math.round(resizeStart.current.w + (me.clientX - resizeStart.current.x) / scale)),
          height: Math.max(30, Math.round(resizeStart.current.h + (me.clientY - resizeStart.current.y) / scale)),
        });
      };
      const handleUp = () => {
        blocker.remove();
        resumeUndo();
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [pos, scale, onPositionChange]
  );

  return (
    <div
      className={`slide-element ${className} ${isDragging ? 'is-dragging' : ''} ${isSelected ? 'is-selected' : ''} ${isSelected && syncId ? 'is-synced' : ''}`}
      data-element-id={elementId}
      data-valign={dataValign}
      style={{
        position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
        zIndex, cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isSelected) onSelect();
        const store = usePresentationStore.getState();
        const items: import('./ContextMenu').MenuEntry[] = [
          ...(onEdit ? [
            { label: 'Edit Text', onClick: () => onEdit() },
            { separator: true as const },
          ] : []),
          { label: 'Cut', shortcut: '\u2318X', onClick: () => {
            // Copy then delete
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
            setTimeout(() => onDelete(), 50);
          }},
          { label: 'Copy', shortcut: '\u2318C', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
          }},
          { label: 'Paste', shortcut: '\u2318V', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true }));
          }},
          { separator: true },
          { label: 'Delete', shortcut: '\u232B', onClick: onDelete },
          { separator: true },
          { label: 'Bring to Front', onClick: () => store.moveElementZ(elementId, 'top') },
          { label: 'Bring Forward', onClick: () => store.moveElementZ(elementId, 'up') },
          { label: 'Send Backward', onClick: () => store.moveElementZ(elementId, 'down') },
          { label: 'Send to Back', onClick: () => store.moveElementZ(elementId, 'bottom') },
          ...(syncId ? [
            { separator: true as const },
            { label: 'Free Position', onClick: () => onUpdate({ syncId: undefined, _syncId: syncId } as any) },
          ] : []),
          ...(linkId ? [
            { label: 'Unlink Animation', onClick: () => onUpdate({ linkId: undefined, _linkId: linkId } as any) },
          ] : []),
        ];
        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
      }}
    >
      {children}
      {/* Link badges — shown when selected */}
      {isSelected && (
        <div className="el-link-badges" onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          {/* Sync badge: green = active, grey = inactive (click to toggle) */}
          {(syncId || _syncId) && (
            <button
              className={`el-link-badge ${syncId ? 'el-badge-sync' : 'el-badge-off'}`}
              title={syncId ? 'Synced — click to free position' : 'Position free — click to re-sync'}
              onClick={() => {
                if (syncId) {
                  // Free position: store syncId as _syncId, clear syncId
                  onUpdate({ syncId: undefined, _syncId: syncId } as any);
                } else if (_syncId) {
                  // Re-sync: restore syncId from _syncId
                  onUpdate({ syncId: _syncId, _syncId: undefined } as any);
                }
              }}>
              S
            </button>
          )}
          {/* Animation badge: purple = active, grey = inactive */}
          {(linkId || _linkId) && (
            <button
              className={`el-link-badge ${linkId ? 'el-badge-anim' : 'el-badge-off'}`}
              title={linkId ? 'Animated — click to unlink' : 'Not animated — click to re-link'}
              onClick={() => {
                if (linkId) {
                  onUpdate({ linkId: undefined, _linkId: linkId } as any);
                } else if (_linkId) {
                  onUpdate({ linkId: _linkId, _linkId: undefined } as any);
                }
              }}>
              A
            </button>
          )}
          {/* Link button: open Time Machine overlay */}
          <button
            className="el-link-badge el-badge-link"
            title="Link to element on another slide"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('open-link-overlay', { detail: { elementId } }));
            }}>
            L
          </button>
        </div>
      )}
      <button className="el-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
      <div className="el-resize-handle" onPointerDown={handleResizeDown} />
    </div>
  );
}

// ============================================
// Arrow renderer
// ============================================
function ArrowRenderer({
  element: a, zIndex, scale, isSelected, onUpdate, onDelete, onSelect,
}: {
  element: Extract<SlideElement, { type: 'arrow' }>; zIndex: number; scale: number;
  isSelected: boolean;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void; onSelect: (e?: { shiftKey: boolean }) => void;
}) {
  const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = a;
  const dragStart = useRef({ mx: 0, my: 0, ox1: 0, oy1: 0, ox2: 0, oy2: 0 });

  // Snap point to nearest 15° angle relative to an anchor
  const snapAngle = (px: number, py: number, ax: number, ay: number): [number, number] => {
    const adx = px - ax, ady = py - ay;
    const dist = Math.sqrt(adx * adx + ady * ady);
    if (dist < 1) return [px, py];
    const angle = Math.atan2(ady, adx);
    const step = Math.PI / 12; // 15°
    const snapped = Math.round(angle / step) * step;
    return [Math.round(ax + dist * Math.cos(snapped)), Math.round(ay + dist * Math.sin(snapped))];
  };

  const handleEndpoint = useCallback(
    (e: React.PointerEvent, which: 'start' | 'end') => {
      e.preventDefault(); e.stopPropagation(); onSelect(); pauseUndo();
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };
      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
        let newX: number, newY: number;
        if (which === 'start') {
          newX = Math.round(dragStart.current.ox1 + dx);
          newY = Math.round(dragStart.current.oy1 + dy);
          if (me.shiftKey) [newX, newY] = snapAngle(newX, newY, dragStart.current.ox2, dragStart.current.oy2);
          onUpdate({ x1: newX, y1: newY } as any);
        } else {
          newX = Math.round(dragStart.current.ox2 + dx);
          newY = Math.round(dragStart.current.oy2 + dy);
          if (me.shiftKey) [newX, newY] = snapAngle(newX, newY, dragStart.current.ox1, dragStart.current.oy1);
          onUpdate({ x2: newX, y2: newY } as any);
        }
      };
      const handleUp = () => { resumeUndo(); window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [x1, y1, x2, y2, scale, onUpdate, onSelect]
  );

  const handleBody = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation(); onSelect(); pauseUndo();
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };
      const handleMove = (me: PointerEvent) => {
        let dx = (me.clientX - dragStart.current.mx) / scale;
        let dy = (me.clientY - dragStart.current.my) / scale;
        // Shift constrains to horizontal or vertical
        if (me.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        onUpdate({
          x1: Math.round(dragStart.current.ox1 + dx), y1: Math.round(dragStart.current.oy1 + dy),
          x2: Math.round(dragStart.current.ox2 + dx), y2: Math.round(dragStart.current.oy2 + dy),
        } as any);
      };
      const handleUp = () => { resumeUndo(); window.removeEventListener('pointermove', handleMove); window.removeEventListener('pointerup', handleUp); };
      window.addEventListener('pointermove', handleMove); window.addEventListener('pointerup', handleUp);
    },
    [x1, y1, x2, y2, scale, onUpdate, onSelect]
  );

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const ha = Math.PI / 6;
  const hx1 = x2 - headSize * Math.cos(angle - ha);
  const hy1 = y2 - headSize * Math.sin(angle - ha);
  const hx2 = x2 - headSize * Math.cos(angle + ha);
  const hy2 = y2 - headSize * Math.sin(angle + ha);
  const pad = 30;
  const minX = Math.min(x1, x2, hx1, hx2) - pad;
  const minY = Math.min(y1, y2, hy1, hy2) - pad;
  const maxX = Math.max(x1, x2, hx1, hx2) + pad;
  const maxY = Math.max(y1, y2, hy1, hy2) + pad;

  return (
    <div className={`slide-element el-arrow ${isSelected ? 'is-selected' : ''}`}
      onClick={(e) => { e.stopPropagation(); onSelect(e.shiftKey ? { shiftKey: true } : undefined); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect();
        const store = usePresentationStore.getState();
        const items: import('./ContextMenu').MenuEntry[] = [
          { label: 'Cut', shortcut: '\u2318X', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
            setTimeout(() => onDelete(), 50);
          }},
          { label: 'Copy', shortcut: '\u2318C', onClick: () => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', metaKey: true }));
          }},
          { separator: true },
          { label: 'Delete', shortcut: '\u232B', onClick: onDelete },
          { separator: true },
          { label: 'Bring to Front', onClick: () => store.moveElementZ(a.id, 'top') },
          { label: 'Bring Forward', onClick: () => store.moveElementZ(a.id, 'up') },
          { label: 'Send Backward', onClick: () => store.moveElementZ(a.id, 'down') },
          { label: 'Send to Back', onClick: () => store.moveElementZ(a.id, 'bottom') },
        ];
        window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
      }}
      style={{ position: 'absolute', left: minX, top: minY, width: maxX - minX, height: maxY - minY, pointerEvents: 'auto', zIndex }}>
      <svg width={maxX - minX} height={maxY - minY} style={{ overflow: 'visible' }}>
        <line x1={x1 - minX} y1={y1 - minY} x2={x2 - minX} y2={y2 - minY}
          stroke="transparent" strokeWidth={24} style={{ pointerEvents: 'stroke', cursor: 'move' }} onPointerDown={handleBody} />
        <line x1={x1 - minX} y1={y1 - minY} x2={x2 - minX} y2={y2 - minY}
          stroke={color} strokeWidth={strokeWidth} style={{ pointerEvents: 'none' }} />
        <polygon points={`${x2 - minX},${y2 - minY} ${hx1 - minX},${hy1 - minY} ${hx2 - minX},${hy2 - minY}`}
          fill={color} style={{ pointerEvents: 'none' }} />
        <circle cx={x1 - minX} cy={y1 - minY} r={8} fill="#fff" stroke={color} strokeWidth={2}
          className="arrow-handle" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpoint(e, 'start')} />
        <circle cx={x2 - minX} cy={y2 - minY} r={8} fill="#fff" stroke={color} strokeWidth={2}
          className="arrow-handle" style={{ pointerEvents: 'all', cursor: 'crosshair' }}
          onPointerDown={(e) => handleEndpoint(e, 'end')} />
      </svg>
      <button className="el-delete-btn" style={{ position: 'absolute', left: (x1 + x2) / 2 - minX - 10, top: (y1 + y2) / 2 - minY - 10, pointerEvents: 'all' }}
        onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
    </div>
  );
}
