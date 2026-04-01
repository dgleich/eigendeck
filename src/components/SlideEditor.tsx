import { useEffect, useRef, useState } from 'react';
import { usePresentationStore } from '../store/presentation';
import { SlideElementRenderer } from './SlideElementRenderer';
import type { SlideLayout } from '../types/presentation';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

const LAYOUTS: { id: SlideLayout; label: string }[] = [
  { id: 'default', label: 'Default' },
  { id: 'centered', label: 'Centered' },
  { id: 'two-column', label: '2 Column' },
];

export function SlideEditor() {
  const {
    presentation, currentSlideIndex, updateSlide,
    addElement, updateElement, deleteElement,
    selectObject, projectPath,
  } = usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

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
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl = reader.result as string;
            if (projectPath) {
              saveImageFromBlob(blob, projectPath).then((relativePath) => {
                addElement({
                  id: crypto.randomUUID(), type: 'image',
                  src: relativePath || dataUrl,
                  position: { x: 360, y: 200, width: 1200, height: 680 },
                });
              });
            } else {
              addElement({
                id: crypto.randomUUID(), type: 'image', src: dataUrl,
                position: { x: 360, y: 200, width: 1200, height: 680 },
              });
            }
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [projectPath, addElement]);

  if (!slide) return null;

  const layout = slide.layout || 'default';
  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');

  return (
    <div className="slide-editor">
      <div className="editor-toolbar">
        <select className="layout-picker" value={layout} title="Slide layout"
          onChange={(e) => updateSlide(currentSlideIndex, { layout: e.target.value as SlideLayout })}>
          {LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </div>
      <div className="slide-canvas-container" ref={containerRef}>
        <div
          className={`slide-canvas slide-layout-${layout}`}
          style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top center' }}
          onClick={(e) => { if (e.target === e.currentTarget) selectObject({ type: 'slide' }); }}
        >
          {slide.elements.map((el, idx) => (
            <SlideElementRenderer
              key={el.id}
              element={el}
              zIndex={idx + 10}
              scale={scale}
              projectPath={projectPath}
              onUpdate={(changes) => updateElement(el.id, changes)}
              onDelete={() => deleteElement(el.id)}
              onSelect={() => selectObject({ type: 'element', id: el.id })}
            />
          ))}
          <div className="slide-footer">
            <span className="slide-footer-meta">{meta}</span>
            <span className="slide-footer-number">{currentSlideIndex + 1}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

async function saveImageFromBlob(blob: File, projectPath: string): Promise<string | null> {
  try {
    const { writeFile, mkdir, exists } = await import('@tauri-apps/plugin-fs');
    const imagesDir = `${projectPath}/images`;
    if (!(await exists(imagesDir))) await mkdir(imagesDir);
    const ext = blob.type.split('/')[1] || 'png';
    const fileName = `pasted-${Date.now()}.${ext}`;
    await writeFile(`${imagesDir}/${fileName}`, new Uint8Array(await blob.arrayBuffer()));
    return `images/${fileName}`;
  } catch (e) {
    console.error('Failed to save pasted image:', e);
    return null;
  }
}
