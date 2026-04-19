import { useEffect, useRef, useState, useCallback } from 'react';
import { usePresentationStore } from '../store/presentation';
import { useDemoUrl } from '../lib/demoAssets';
import { SlideElementRenderer } from './SlideElementRenderer';
import { getSlideNumber, createTextElement } from '../types/presentation';
import { resolveTheme } from '../lib/themes';
import type { SlideElement } from '../types/presentation';
import type { MenuEntry } from './ContextMenu';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

// Layout constants moved to PropertiesPanel

export function SlideEditor() {
  const {
    presentation, currentSlideIndex,
    addElement, updateElement, deleteElement,
    selectObject, toggleSelectElement, selectedObject, projectPath,
  } = usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const padding = 32;
        setScale(Math.min((width - padding) / SLIDE_WIDTH, (height - padding) / SLIDE_HEIGHT, 1));
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Cmd+V image paste
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      // Don't intercept paste if user is editing a text element
      if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (!blob) continue;

          const ext = blob.type.split('/')[1] || 'png';
          const fileName = `pasted-${Date.now()}.${ext}`;
          const relativePath = `images/${fileName}`;
          const bytes = new Uint8Array(await blob.arrayBuffer());

          // Store as SQLite asset
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const mime = blob.type || `image/${ext}`;
            await invoke('db_store_asset', { path: relativePath, data: Array.from(bytes), mimeType: mime });
          } catch (e) {
            console.error('Failed to store pasted image:', e);
          }

          // Use data URL for display (SQLite BLOBs can't be loaded via convertFileSrc)
          const reader = new FileReader();
          reader.onload = () => {
            addElement({
              id: crypto.randomUUID(), type: 'image',
              src: reader.result as string, // data URL for display
              position: { x: 360, y: 200, width: 1200, height: 680 },
            });
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [projectPath, addElement]);

  // Marquee drag-to-select on canvas background
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // only on canvas background
    e.preventDefault();
    selectObject({ type: 'slide' });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = (e.clientX - rect.left) / scale;
    const startY = (e.clientY - rect.top) / scale;

    setMarquee({ x1: startX, y1: startY, x2: startX, y2: startY });

    const handleMove = (me: PointerEvent) => {
      const mx = (me.clientX - rect.left) / scale;
      const my = (me.clientY - rect.top) / scale;
      setMarquee({ x1: startX, y1: startY, x2: mx, y2: my });
    };

    const handleUp = (me: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);

      const mx = (me.clientX - rect.left) / scale;
      const my = (me.clientY - rect.top) / scale;
      const selX1 = Math.min(startX, mx);
      const selY1 = Math.min(startY, my);
      const selX2 = Math.max(startX, mx);
      const selY2 = Math.max(startY, my);

      // Only select if marquee is larger than a small threshold (avoid accidental clicks)
      if (selX2 - selX1 > 5 || selY2 - selY1 > 5) {
        const currentSlide = usePresentationStore.getState().presentation.slides[
          usePresentationStore.getState().currentSlideIndex
        ];
        const hitIds = currentSlide.elements
          .filter((el: SlideElement) => {
            if (el.type === 'arrow') {
              // Check if either endpoint is inside the marquee
              return (el.x1 >= selX1 && el.x1 <= selX2 && el.y1 >= selY1 && el.y1 <= selY2) ||
                     (el.x2 >= selX1 && el.x2 <= selX2 && el.y2 >= selY1 && el.y2 <= selY2);
            }
            // Box intersection test
            const elX1 = el.position.x;
            const elY1 = el.position.y;
            const elX2 = el.position.x + el.position.width;
            const elY2 = el.position.y + el.position.height;
            return elX1 < selX2 && elX2 > selX1 && elY1 < selY2 && elY2 > selY1;
          })
          .map((el: SlideElement) => el.id);

        if (hitIds.length === 1) {
          selectObject({ type: 'element', id: hitIds[0] });
        } else if (hitIds.length > 1) {
          selectObject({ type: 'multi', ids: hitIds });
        }
      }

      setMarquee(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [scale, selectObject]);

  // Context menu for canvas background
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const store = usePresentationStore.getState();
    const items: MenuEntry[] = [
      { label: 'Add Title', onClick: () => store.addElement(createTextElement('title')) },
      { label: 'Add Body', onClick: () => store.addElement(createTextElement('body')) },
      { label: 'Add Text Box', onClick: () => store.addElement(createTextElement('textbox')) },
      { label: 'Add Annotation', onClick: () => store.addElement(createTextElement('annotation')) },
      { label: 'Add Footnote', onClick: () => store.addElement(createTextElement('footnote')) },
      { separator: true },
      { label: 'Add Arrow', onClick: () => store.addElement({ id: crypto.randomUUID(), type: 'arrow', x1: 400, y1: 400, x2: 800, y2: 400, position: { x: 0, y: 0, width: 0, height: 0 }, color: '#2563eb', strokeWidth: 4, headSize: 16 }) },
      { separator: true },
      { label: 'Paste', shortcut: '\u2318V', onClick: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true })) },
      { separator: true },
      { label: 'Slide Properties', onClick: () => {
        store.selectObject({ type: 'slide' });
        if (!store.showProperties) store.toggleProperties();
      }},
    ];
    window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
  }, []);

  // Drag-and-drop files onto canvas
  const [dragOver, setDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const store = usePresentationStore.getState();
    const files = Array.from(e.dataTransfer.files);

    for (const file of files) {
      const name = file.name.toLowerCase();
      const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name);
      const isHtml = /\.html?$/i.test(name);

      if (isImage) {
        if (store.projectPath) {
          try {
            const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
            const imagesDir = `${store.projectPath}/images`;
            if (!(await exists(imagesDir))) await mkdir(imagesDir);
            const bytes = new Uint8Array(await file.arrayBuffer());
            await writeFile(`${imagesDir}/${file.name}`, bytes);
            store.addElement({
              id: crypto.randomUUID(), type: 'image',
              src: `images/${file.name}`,
              position: { x: 360, y: 200, width: 1200, height: 680 },
            });
          } catch (err) {
            console.error('Failed to save dropped image:', err);
            // Fallback to data URL
            const reader = new FileReader();
            reader.onload = () => {
              store.addElement({
                id: crypto.randomUUID(), type: 'image',
                src: reader.result as string,
                position: { x: 360, y: 200, width: 1200, height: 680 },
              });
            };
            reader.readAsDataURL(file);
          }
        } else {
          const reader = new FileReader();
          reader.onload = () => {
            store.addElement({
              id: crypto.randomUUID(), type: 'image',
              src: reader.result as string,
              position: { x: 360, y: 200, width: 1200, height: 680 },
            });
          };
          reader.readAsDataURL(file);
        }
      } else if (isHtml) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const bytes = new Uint8Array(await file.arrayBuffer());
          const relativePath = `demos/${file.name}`;
          await invoke('db_store_asset', { path: relativePath, data: Array.from(bytes), mimeType: 'text/html' });
          store.addElement({
            id: crypto.randomUUID(), type: 'demo',
            src: relativePath,
            position: { x: 80, y: 200, width: 1760, height: 700 },
          });
        } catch (err) {
          console.error('Failed to store dropped HTML:', err);
        }
      }
    }
  }, []);

  // Tauri drag-drop event (provides file paths directly)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = getCurrentWebviewWindow();
        unlisten = await win.onDragDropEvent(async (event) => {
          if (event.payload.type === 'drop') {
            const paths: string[] = event.payload.paths;
            const store = usePresentationStore.getState();
            for (const fullPath of paths) {
              const name = fullPath.split('/').pop() || '';
              const isImage = /\.(png|jpg|jpeg|gif|svg|webp)$/i.test(name);
              const isHtml = /\.html?$/i.test(name);

              if (isImage) {
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const { readFile } = await import('@tauri-apps/plugin-fs');
                  const relativePath = `images/${name}`;
                  const bytes = await readFile(fullPath);
                  const ext = name.split('.').pop()?.toLowerCase() || 'png';
                  const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                  await invoke('db_store_asset', { path: relativePath, data: Array.from(bytes), mimeType: mime });
                  store.addElement({
                    id: crypto.randomUUID(), type: 'image',
                    src: relativePath,
                    position: { x: 360, y: 200, width: 1200, height: 680 },
                  });
                } catch (err) { console.error('Failed to handle dropped image:', err); }
              } else if (isHtml) {
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const { readFile, readTextFile } = await import('@tauri-apps/plugin-fs');
                  const relativePath = `demos/${name}`;
                  const bytes = await readFile(fullPath);
                  await invoke('db_store_asset', { path: relativePath, data: Array.from(bytes), mimeType: 'text/html' });

                  // Detect demo-piece demos
                  const html = await readTextFile(fullPath);
                  const pieceMatches = html.matchAll(/piece\s*===?\s*['"](\w+)['"]/g);
                  const pieces = [...new Set([...pieceMatches].map((m: RegExpMatchArray) => m[1]))];

                  if (pieces.length > 0 && html.includes('BroadcastChannel')) {
                    let x = 80;
                    for (const piece of pieces) {
                      const width = Math.floor((1760 - (pieces.length - 1) * 40) / pieces.length);
                      store.addElement({
                        id: crypto.randomUUID(), type: 'demo-piece' as any,
                        demoSrc: relativePath, piece,
                        position: { x, y: 200, width, height: 700 },
                      });
                      x += width + 40;
                    }
                  } else {
                    store.addElement({
                      id: crypto.randomUUID(), type: 'demo',
                      src: relativePath,
                      position: { x: 80, y: 200, width: 1760, height: 700 },
                    });
                  }
                } catch (err) { console.error('Failed to handle dropped HTML:', err); }
              }
            }
          }
        });
      } catch {
        // Not in Tauri — HTML5 drag events will handle it
      }
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  if (!slide) return null;

  const layout = slide.layout || 'default';
  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');

  return (
    <div className="slide-editor">
      {/* Layout/theme now in inspector panel (PropertiesPanel) */}
      <div className={`slide-canvas-container ${dragOver ? 'drag-over' : ''}`} ref={containerRef}
        onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <div
          ref={canvasRef}
          className={`slide-canvas slide-layout-${layout}`}
          style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top center',
            backgroundColor: resolveTheme(presentation.theme, slide.theme).background }}
          onPointerDown={handleCanvasPointerDown}
          onContextMenu={handleCanvasContextMenu}
        >
          {slide.elements.map((el, idx) => {
            const isSelected = selectedObject?.type === 'element' && selectedObject.id === el.id
              || selectedObject?.type === 'multi' && selectedObject.ids.includes(el.id);
            return (
              <SlideElementRenderer
                key={el.id}
                element={el}
                zIndex={idx + 10}
                scale={scale}
                projectPath={projectPath}
                isSelected={isSelected}
                onUpdate={(changes) => updateElement(el.id, changes)}
                onDelete={() => deleteElement(el.id)}
                onSelect={(e) => {
                  if (e?.shiftKey) toggleSelectElement(el.id);
                  else selectObject({ type: 'element', id: el.id });
                }}
              />
            );
          })}
          {/* Hidden controller iframes for demo-piece elements */}
          {(() => {
            const demoSrcs = new Set<string>();
            for (const el of slide.elements) {
              if (el.type === 'demo-piece') demoSrcs.add(el.demoSrc);
            }
            return Array.from(demoSrcs).map((demoSrc) => (
              <ControllerIframe key={`controller-${demoSrc}`} assetPath={demoSrc} />
            ));
          })()}
          {marquee && (() => {
            const x = Math.min(marquee.x1, marquee.x2);
            const y = Math.min(marquee.y1, marquee.y2);
            const w = Math.abs(marquee.x2 - marquee.x1);
            const h = Math.abs(marquee.y2 - marquee.y1);
            return (
              <div className="marquee-selection" style={{
                position: 'absolute', left: x, top: y, width: w, height: h,
                border: '2px dashed #3b82f6', background: 'rgba(59, 130, 246, 0.08)',
                pointerEvents: 'none', zIndex: 9998,
              }} />
            );
          })()}
          <div className="slide-footer">
            <span className="slide-footer-meta">{meta}</span>
            <span className="slide-footer-number">{getSlideNumber(presentation.slides, currentSlideIndex)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hidden controller iframe that loads demo HTML from SQLite */
function ControllerIframe({ assetPath }: { assetPath: string }) {
  const src = useDemoUrl(assetPath, 'role=controller');
  if (!src) return null;
  return (
    <iframe
      src={src}
      sandbox="allow-scripts allow-same-origin"
      title={`controller: ${assetPath}`}
      style={{ position: 'absolute', width: 0, height: 0, border: 'none', opacity: 0, pointerEvents: 'none' }}
    />
  );
}
