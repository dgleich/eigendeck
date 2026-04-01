import { useEffect, useState, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './components/Toolbar';
import { SlideSidebar } from './components/SlideSidebar';
import { SlideEditor } from './components/SlideEditor';
import { PresentMode } from './components/PresentMode';
import { NotesPanel } from './components/NotesPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { usePresentationStore } from './store/presentation';
import {
  saveProject,
  openProject,
  createProject,
  exportPresentation,
} from './store/fileOps';
import './App.css';

function App() {
  const { isPresenting, showProperties } =
    usePresentationStore();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

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
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveProject(); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); usePresentationStore.temporal.getState().undo(); }
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); usePresentationStore.temporal.getState().redo(); }
      if (e.key === 'i' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); usePresentationStore.getState().toggleProperties(); }
      if (e.key === 'F5') { e.preventDefault(); usePresentationStore.getState().setPresenting(true); }
      // Delete selected element
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const sel = usePresentationStore.getState().selectedObject;
        if (sel?.type === 'element') { e.preventDefault(); usePresentationStore.getState().deleteElement(sel.id); }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
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
            <button title="Add title" onClick={() => store.addElement({ id: crypto.randomUUID(), type: 'title', text: 'Title', position: { x: 80, y: 40, width: 1760, height: 100 }, fontSize: 56 })}>+ Title</button>
            <button title="Add text box" onClick={() => store.addElement({ id: crypto.randomUUID(), type: 'textBox', html: '<p>Text</p>', position: { x: 200, y: 300, width: 600, height: 200 } })}>+ Text Box</button>
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
    </div>
  );
}

export default App;
