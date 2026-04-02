import { useRef, useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { pauseUndo, resumeUndo } from '../store/presentation';
import { TEXT_PRESET_STYLES } from '../types/presentation';
import { TextFormatToolbar } from './TextFormatToolbar';
import { typesetElement, resetMathElement, containsMath, getDisplayMathHeight } from '../lib/mathjax';
import type { SlideElement, ElementPosition, TextElement } from '../types/presentation';

interface Props {
  element: SlideElement;
  zIndex: number;
  scale: number;
  projectPath: string | null;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void;
  onSelect: () => void;
}

export function SlideElementRenderer({
  element, zIndex, scale, projectPath, onUpdate, onDelete, onSelect,
}: Props) {
  switch (element.type) {
    case 'text':
      return (
        <DraggableBox
          position={element.position} zIndex={zIndex} scale={scale}
          className={`el-text el-preset-${element.preset}`}
          onSelect={onSelect} onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
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
          position={element.position} zIndex={zIndex} scale={scale}
          className="el-image" onSelect={onSelect} onDelete={onDelete}
          onPositionChange={(pos) => onUpdate({ position: pos } as any)}
        >
          <img src={src} alt="" draggable={false}
            style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }} />
        </DraggableBox>
      );
    }

    case 'demo':
      return (
        <DemoBox
          element={element} zIndex={zIndex} scale={scale}
          projectPath={projectPath} onSelect={onSelect} onDelete={onDelete}
          onUpdate={onUpdate}
        />
      );

    case 'arrow':
      return (
        <ArrowRenderer element={element} zIndex={zIndex} scale={scale}
          onUpdate={onUpdate} onDelete={onDelete} onSelect={onSelect} />
      );
  }
}

// ============================================
// ============================================
// Demo element with overlay for dragging
// ============================================
function DemoBox({ element, zIndex, scale, projectPath, onSelect, onDelete, onUpdate }: {
  element: Extract<SlideElement, { type: 'demo' }>;
  zIndex: number; scale: number; projectPath: string | null;
  onSelect: () => void; onDelete: () => void;
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
      position={element.position} zIndex={zIndex} scale={scale}
      className="el-demo" onSelect={onSelect} onDelete={onDelete}
      onPositionChange={(pos) => onUpdate({ position: pos } as any)}
    >
      {src ? (
        <iframe src={src} sandbox="allow-scripts allow-same-origin" title="demo"
          style={{ width: '100%', height: '100%', border: 'none', pointerEvents: interacting ? 'auto' : 'none' }} />
      ) : <div style={{ padding: 20, color: '#999' }}>Demo: {element.src}</div>}
      {/* Overlay: blocks iframe events so drag works. Double-click to interact with demo. */}
      {!interacting && (
        <div
          className="demo-overlay"
          onDoubleClick={(e) => { e.stopPropagation(); setInteracting(true); }}
          style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            cursor: 'grab', zIndex: 1,
          }}
        />
      )}
      {interacting && (
        <button
          className="demo-lock-btn"
          onClick={() => setInteracting(false)}
          style={{
            position: 'absolute', top: 4, right: 4, zIndex: 2,
            padding: '2px 8px', fontSize: 11, border: '1px solid #ccc',
            borderRadius: 3, background: 'rgba(255,255,255,0.9)', cursor: 'pointer',
          }}
        >
          Lock
        </button>
      )}
    </DraggableBox>
  );
}

// ============================================
// Text content with preset styling
// ============================================
function TextContent({
  element,
  onCommit,
}: {
  element: TextElement;
  onCommit: (html: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [typesetCounter, setTypesetCounter] = useState(0);
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
  };

  // Display mode: render HTML and typeset math
  useEffect(() => {
    if (mainRef.current && !editing) {
      resetMathElement(mainRef.current, element.html);
      if (containsMath(element.html)) {
        typesetElement(mainRef.current);
      }
    }
  }, [element.html, editing, typesetCounter]);

  // Position toolbar
  useEffect(() => {
    if (editing && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setToolbarPos({ top: rect.top - 46, left: rect.left, width: rect.width });
    }
  }, [editing]);

  // Apply nowrap to lines starting with $$
  // Extract TeX from a $$ line, e.g. "$$\int_0^1 f(x)$$" → "\int_0^1 f(x)"
  const extractDisplayTex = (text: string): string | null => {
    const trimmed = text.trim();
    const match = trimmed.match(/^\$\$([\s\S]*?)\$\$/);
    return match ? match[1] : null;
  };

  const applyMathLineStyles = (el: HTMLElement) => {
    const applyToNode = (node: HTMLElement) => {
      const text = node.textContent || '';
      if (text.trimStart().startsWith('$$')) {
        node.style.whiteSpace = 'nowrap';
        node.style.overflowX = 'auto';
        // Use cached SVG height to prevent layout jump on re-edit
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
      }
    };

    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        applyToNode(child as HTMLElement);
      }
    }
    // Also check root element for single $$ line
    if (el.childNodes.length <= 1 && (el.textContent || '').trimStart().startsWith('$$')) {
      applyToNode(el);
    } else {
      el.style.whiteSpace = '';
      el.style.overflowX = '';
      el.style.minHeight = '';
      el.style.lineHeight = '';
    }
  };

  const startEditing = () => {
    setEditing(true);
    setTimeout(() => {
      if (mainRef.current) {
        // Replace MathJax SVGs with raw source for editing
        mainRef.current.innerHTML = element.html;
        applyMathLineStyles(mainRef.current);
        mainRef.current.focus();
        requestAnimationFrame(() => {
          if (mainRef.current) applyMathLineStyles(mainRef.current);
        });
        const sel = window.getSelection();
        if (sel) {
          sel.selectAllChildren(mainRef.current);
          sel.collapseToEnd();
        }
      }
    }, 0);
  };

  const commitAndClose = () => {
    if (mainRef.current) {
      // Strip $$ line styles before saving
      for (const child of Array.from(mainRef.current.querySelectorAll('*'))) {
        const el = child as HTMLElement;
        if (el.style.whiteSpace === 'nowrap') el.style.whiteSpace = '';
        if (el.style.overflowX === 'auto') el.style.overflowX = '';
        if (el.style.minHeight) el.style.minHeight = '';
        if (el.style.lineHeight) el.style.lineHeight = '';
        if (el.style.display === 'flex') el.style.display = '';
        if (el.style.alignItems) el.style.alignItems = '';
      }
      mainRef.current.style.whiteSpace = '';
      mainRef.current.style.overflowX = '';
      mainRef.current.style.minHeight = '';
      mainRef.current.style.lineHeight = '';
      mainRef.current.style.display = '';
      mainRef.current.style.alignItems = '';
      onCommit(mainRef.current.innerHTML);
    }
    setEditing(false);
    setTypesetCounter((c) => c + 1);
  };

  // Single div for both display and edit
  const mainRef = useRef<HTMLDivElement>(null);

  // Warm up WebKit's contentEditable on mount to prevent first-click shift
  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.contentEditable = 'true';
      // Force a layout calc so WebKit initializes editing state
      mainRef.current.getBoundingClientRect();
      mainRef.current.contentEditable = 'false';
    }
  }, []);

  return (
    <div ref={wrapperRef} style={{ width: '100%', height: '100%' }}>
      {editing && createPortal(
        <div style={{
          position: 'fixed',
          top: toolbarPos.top,
          left: toolbarPos.left,
          width: Math.max(toolbarPos.width, 500),
          zIndex: 9999,
        }}>
          <TextFormatToolbar onClose={commitAndClose} />
        </div>,
        document.body
      )}

      <div
        ref={mainRef}
        style={{ ...style, cursor: editing ? 'text' : 'inherit' }}
        contentEditable={editing}
        suppressContentEditableWarning
        onDoubleClick={() => { if (!editing) startEditing(); }}
        onBlur={editing ? (e) => {
          const related = e.relatedTarget as HTMLElement | null;
          if (related?.closest('.text-format-toolbar')) return;
          setTimeout(() => {
            if (!document.activeElement?.closest('.text-format-toolbar')) {
              commitAndClose();
            }
          }, 100);
        } : undefined}
        onInput={editing ? () => {
          if (mainRef.current) applyMathLineStyles(mainRef.current);
        } : undefined}
        onKeyDown={editing ? (e) => {
          if (e.key === 'Escape') { commitAndClose(); }
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
  position: pos, zIndex, scale, className, children, onSelect, onDelete, onPositionChange,
}: {
  position: ElementPosition; zIndex: number; scale: number; className: string;
  children: React.ReactNode; onSelect: () => void; onDelete: () => void;
  onPositionChange: (pos: ElementPosition) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest('.el-resize-handle, .el-delete-btn, [contenteditable="true"]')) return;
      e.preventDefault(); e.stopPropagation();
      onSelect();
      setIsDragging(true);
      pauseUndo();
      dragStart.current = { x: e.clientX, y: e.clientY, posX: pos.x, posY: pos.y };

      const handleMove = (me: PointerEvent) => {
        onPositionChange({
          ...pos,
          x: Math.round(dragStart.current.posX + (me.clientX - dragStart.current.x) / scale),
          y: Math.round(dragStart.current.posY + (me.clientY - dragStart.current.y) / scale),
        });
      };
      const handleUp = () => {
        setIsDragging(false); resumeUndo();
        window.removeEventListener('pointermove', handleMove);
        window.removeEventListener('pointerup', handleUp);
      };
      window.addEventListener('pointermove', handleMove);
      window.addEventListener('pointerup', handleUp);
    },
    [pos, scale, onSelect, onPositionChange]
  );

  const handleResizeDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault(); e.stopPropagation(); pauseUndo();
      resizeStart.current = { x: e.clientX, y: e.clientY, w: pos.width, h: pos.height };
      const handleMove = (me: PointerEvent) => {
        onPositionChange({
          ...pos,
          width: Math.max(50, Math.round(resizeStart.current.w + (me.clientX - resizeStart.current.x) / scale)),
          height: Math.max(30, Math.round(resizeStart.current.h + (me.clientY - resizeStart.current.y) / scale)),
        });
      };
      const handleUp = () => {
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
      className={`slide-element ${className} ${isDragging ? 'is-dragging' : ''}`}
      style={{
        position: 'absolute', left: pos.x, top: pos.y, width: pos.width, height: pos.height,
        zIndex, cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onClick={(e) => { e.stopPropagation(); onSelect(); }}
    >
      {children}
      <button className="el-delete-btn" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Delete">×</button>
      <div className="el-resize-handle" onPointerDown={handleResizeDown} />
    </div>
  );
}

// ============================================
// Arrow renderer
// ============================================
function ArrowRenderer({
  element: a, zIndex, scale, onUpdate, onDelete, onSelect,
}: {
  element: Extract<SlideElement, { type: 'arrow' }>; zIndex: number; scale: number;
  onUpdate: (changes: Partial<SlideElement>) => void;
  onDelete: () => void; onSelect: () => void;
}) {
  const { x1, y1, x2, y2, color = '#e53e3e', strokeWidth = 4, headSize = 16 } = a;
  const dragStart = useRef({ mx: 0, my: 0, ox1: 0, oy1: 0, ox2: 0, oy2: 0 });

  const handleEndpoint = useCallback(
    (e: React.PointerEvent, which: 'start' | 'end') => {
      e.preventDefault(); e.stopPropagation(); onSelect(); pauseUndo();
      dragStart.current = { mx: e.clientX, my: e.clientY, ox1: x1, oy1: y1, ox2: x2, oy2: y2 };
      const handleMove = (me: PointerEvent) => {
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
        if (which === 'start') onUpdate({ x1: Math.round(dragStart.current.ox1 + dx), y1: Math.round(dragStart.current.oy1 + dy) } as any);
        else onUpdate({ x2: Math.round(dragStart.current.ox2 + dx), y2: Math.round(dragStart.current.oy2 + dy) } as any);
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
        const dx = (me.clientX - dragStart.current.mx) / scale;
        const dy = (me.clientY - dragStart.current.my) / scale;
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
    <div className="slide-element el-arrow" onClick={(e) => { e.stopPropagation(); onSelect(); }}
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
