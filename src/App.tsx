import { useEffect, useState, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './components/Toolbar';
import { SlideSidebar } from './components/SlideSidebar';
import { SlideEditor } from './components/SlideEditor';
import { PresentMode } from './components/PresentMode';
import { NotesPanel } from './components/NotesPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { DebugConsole } from './components/DebugConsole';
import { LinkOverlay } from './components/LinkOverlay';
import { ContextMenu } from './components/ContextMenu';
import type { MenuEntry } from './components/ContextMenu';
import { usePresentationStore } from './store/presentation';
import { createTextElement } from './types/presentation';
import type { SlideElement } from './types/presentation';
import {
  saveProject,
  openProject,
  createProject,
  exportPresentation,
} from './store/fileOps';
import { initAutoSave, forceSave } from './store/autoSave';
import './App.css';

function App() {
  const { isPresenting, showProperties } =
    usePresentationStore();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const clipboardRef = useRef<{ type: 'elements'; data: SlideElement[] } | { type: 'slide'; data: any } | null>(null);
  const [linkOverlayElementId, setLinkOverlayElementId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizeStartX.current = e.clientX;
    resizeStartW.current = sidebarWidth;
    const handleMove = (me: PointerEvent) => {
      setSidebarWidth(Math.min(400, Math.max(150, resizeStartW.current + me.clientX - resizeStartX.current)));
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [sidebarWidth]);

  // Initialize auto-save
  useEffect(() => { initAutoSave(); }, []);

  // Warn before closing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (usePresentationStore.getState().isDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); forceSave().catch(() => saveProject()); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); usePresentationStore.temporal.getState().undo(); }
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); usePresentationStore.temporal.getState().redo(); }
      if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); usePresentationStore.getState().toggleProperties(); }
      if (e.key === 'F5') { e.preventDefault(); forceSave().then(() => usePresentationStore.getState().setPresenting(true)); }
      // Delete selected element
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const sel = usePresentationStore.getState().selectedObject;
        if (sel?.type === 'element') { e.preventDefault(); usePresentationStore.getState().deleteElement(sel.id); }
        if (sel?.type === 'multi') { e.preventDefault(); usePresentationStore.getState().deleteElements(sel.ids); }
      }
      // Arrow keys: navigate slides when no element is focused for editing
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const state = usePresentationStore.getState();
        const sel = state.selectedObject;
        if (!sel || sel.type === 'slide') {
          e.preventDefault();
          const idx = state.currentSlideIndex;
          const total = state.presentation.slides.length;
          if (e.key === 'ArrowUp' && idx > 0) state.selectSlide(idx - 1);
          if (e.key === 'ArrowDown' && idx < total - 1) state.selectSlide(idx + 1);
        }
      }
      // Copy (Cmd+C) — only when not editing text
      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const state = usePresentationStore.getState();
        const sel = state.selectedObject;
        const slide = state.presentation.slides[state.currentSlideIndex];
        if (sel?.type === 'element') {
          const el = slide.elements.find((el) => el.id === sel.id);
          if (el) clipboardRef.current = { type: 'elements', data: [JSON.parse(JSON.stringify(el))] };
        } else if (sel?.type === 'multi') {
          clipboardRef.current = { type: 'elements', data: slide.elements
            .filter((el) => sel.ids.includes(el.id))
            .map((el) => JSON.parse(JSON.stringify(el))) };
        } else if (!sel || sel.type === 'slide') {
          clipboardRef.current = { type: 'slide', data: JSON.parse(JSON.stringify(slide)) };
        }
      }
      // Paste (Cmd+V) — only when not editing text (image paste handled separately)
      if (e.key === 'v' && (e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const clip = clipboardRef.current;
        if (clip?.type === 'elements') {
          e.preventDefault();
          const state = usePresentationStore.getState();
          const newIds: string[] = [];
          for (const el of clip.data) {
            const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID() };
            if (newEl.type === 'arrow') {
              newEl.x1 += 40; newEl.y1 += 40; newEl.x2 += 40; newEl.y2 += 40;
            } else {
              newEl.position = { ...newEl.position, x: newEl.position.x + 40, y: newEl.position.y + 40 };
            }
            state.addElement(newEl);
            newIds.push(newEl.id);
          }
          if (newIds.length === 1) state.selectObject({ type: 'element', id: newIds[0] });
          else if (newIds.length > 1) state.selectObject({ type: 'multi', ids: newIds });
        } else if (clip?.type === 'slide') {
          e.preventDefault();
          usePresentationStore.getState().duplicateSlide(usePresentationStore.getState().currentSlideIndex);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Context menu: global event listener + suppress default
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setContextMenu({ x: detail.x, y: detail.y, items: detail.items });
    };
    const suppress = (e: MouseEvent) => {
      // Allow default context menu in inputs/textareas
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;
      e.preventDefault();
    };
    window.addEventListener('show-context-menu', handler);
    window.addEventListener('contextmenu', suppress);
    return () => {
      window.removeEventListener('show-context-menu', handler);
      window.removeEventListener('contextmenu', suppress);
    };
  }, []);

  // Link overlay custom event
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.elementId) setLinkOverlayElementId(detail.elementId);
    };
    window.addEventListener('open-link-overlay', handler);
    return () => window.removeEventListener('open-link-overlay', handler);
  }, []);

  // Native menu events
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      switch (event.payload) {
        case 'new-project': createProject(); break;
        case 'open-project': openProject(); break;
        case 'save': saveProject(); break;
        case 'export': exportPresentation(); break;
        case 'present': usePresentationStore.getState().setPresenting(true); break;
        case 'inspector': usePresentationStore.getState().toggleProperties(); break;
        case 'debug-console': window.dispatchEvent(new CustomEvent('toggle-debug-console')); break;
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  if (isPresenting) return <PresentMode />;

  const store = usePresentationStore.getState();

  return (
    <div className="app">
      <Toolbar />
      <div className="main-area">
        <div style={{ width: sidebarWidth, minWidth: 150, maxWidth: 400, flexShrink: 0 }}>
          <SlideSidebar />
        </div>
        <div className="sidebar-resize-handle" onPointerDown={handleResizeStart} />
        <div className="editor-area">
          <div className="editor-actions">
            <button title="Add title text" onClick={() => store.addElement(createTextElement('title'))}>+ Title</button>
            <button title="Add body text" onClick={() => store.addElement(createTextElement('body'))}>+ Body</button>
            <button title="Add text box" onClick={() => store.addElement(createTextElement('textbox'))}>+ Text</button>
            <button title="Add annotation (small, blue, italic)" onClick={() => store.addElement(createTextElement('annotation'))}>+ Note</button>
            <button title="Add footnote (small, grey, narrow)" onClick={() => store.addElement(createTextElement('footnote'))}>+ Footnote</button>
            <span className="divider" />
            <button title="Add arrow" onClick={() => store.addElement({ id: crypto.randomUUID(), type: 'arrow', x1: 400, y1: 400, x2: 800, y2: 400, position: { x: 0, y: 0, width: 0, height: 0 }, color: '#e53e3e', strokeWidth: 4, headSize: 16 })}>+ Arrow</button>
            <button title="Add image from file" onClick={async () => {
              const { open, message } = await import('@tauri-apps/plugin-dialog');
              if (!store.projectPath) { await message('Please save or open a project first.', { title: 'No Project Open', kind: 'info' }); return; }
              const selected = await open({ title: 'Select Image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }] });
              if (!selected) return;
              const fullPath = selected as string;
              const fileName = fullPath.split('/').pop() || 'image.png';
              const relativePath = fullPath.startsWith(store.projectPath) ? fullPath.slice(store.projectPath.length + 1) : `images/${fileName}`;
              if (!fullPath.startsWith(store.projectPath)) {
                try {
                  const { readFile, writeFile, exists, mkdir } = await import('@tauri-apps/plugin-fs');
                  const imagesDir = `${store.projectPath}/images`;
                  if (!(await exists(imagesDir))) await mkdir(imagesDir);
                  await writeFile(`${imagesDir}/${fileName}`, await readFile(fullPath));
                } catch (err) { console.error('Copy failed:', err); }
              }
              store.addElement({ id: crypto.randomUUID(), type: 'image', src: relativePath, position: { x: 360, y: 200, width: 1200, height: 680 } });
            }}>+ Image</button>
            <button title="Add demo HTML" onClick={async () => {
              const { open, message } = await import('@tauri-apps/plugin-dialog');
              if (!store.projectPath) { await message('Please save or open a project first.', { title: 'No Project Open', kind: 'info' }); return; }
              const selected = await open({ title: 'Select Demo', defaultPath: `${store.projectPath}/demos`, filters: [{ name: 'HTML', extensions: ['html'] }] });
              if (!selected) return;
              const fullPath = selected as string;
              const relativePath = fullPath.startsWith(store.projectPath) ? fullPath.slice(store.projectPath.length + 1) : fullPath;
              store.addElement({ id: crypto.randomUUID(), type: 'demo', src: relativePath, position: { x: 80, y: 200, width: 1760, height: 700 } });
            }}>+ Demo</button>
          </div>
          <SlideEditor />
          <NotesPanel />
        </div>
        {showProperties && <PropertiesPanel />}
      </div>
      <DebugConsole />
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} items={contextMenu.items}
          onClose={() => setContextMenu(null)} />
      )}
      {linkOverlayElementId && (
        <LinkOverlay
          elementId={linkOverlayElementId}
          onClose={() => setLinkOverlayElementId(null)}
        />
      )}
    </div>
  );
}

export default App;
