import { useEffect, useState, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './components/Toolbar';
import { SlideSidebar } from './components/SlideSidebar';
import { SlideEditor } from './components/SlideEditor';
import { PresentMode } from './components/PresentMode';
import { AddDemoButton, RemoveDemoButton } from './components/DemoFrame';
import { AddImageButton, RemoveImageButton } from './components/ImageElement';
import { NotesPanel } from './components/NotesPanel';
import { usePresentationStore } from './store/presentation';
import {
  saveProject,
  openProject,
  createProject,
  exportPresentation,
} from './store/fileOps';
import './App.css';

function App() {
  const { isPresenting, presentation, currentSlideIndex } =
    usePresentationStore();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizing = useRef(false);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    resizing.current = true;
    resizeStartX.current = e.clientX;
    resizeStartW.current = sidebarWidth;

    const handleMove = (me: PointerEvent) => {
      const dx = me.clientX - resizeStartX.current;
      const newW = Math.min(400, Math.max(150, resizeStartW.current + dx));
      setSidebarWidth(newW);
    };
    const handleUp = () => {
      resizing.current = false;
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

  // Warn before closing with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (usePresentationStore.getState().isDirty) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        saveProject();
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        e.preventDefault();
        usePresentationStore.temporal.getState().undo();
      }
      if (
        (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
        (e.key === 'y' && (e.ctrlKey || e.metaKey))
      ) {
        e.preventDefault();
        usePresentationStore.temporal.getState().redo();
      }
      if (e.key === 'F5') {
        e.preventDefault();
        usePresentationStore.getState().setPresenting(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Native menu event handler
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      switch (event.payload) {
        case 'new-project':
          createProject();
          break;
        case 'open-project':
          openProject();
          break;
        case 'save':
          saveProject();
          break;
        case 'export':
          exportPresentation();
          break;
        case 'present':
          usePresentationStore.getState().setPresenting(true);
          break;
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  if (isPresenting) {
    return <PresentMode />;
  }

  const slide = presentation.slides[currentSlideIndex];

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
            <AddDemoButton />
            <RemoveDemoButton />
            <AddImageButton />
            <RemoveImageButton />
            <button
              onClick={() => {
                const store = usePresentationStore.getState();
                const idx = store.currentSlideIndex;
                const s = store.presentation.slides[idx];
                const boxes = [...(s.content.textBoxes || [])];
                boxes.push({
                  id: crypto.randomUUID(),
                  html: '<p>Text</p>',
                  position: { x: 200, y: 300, width: 600, height: 200 },
                });
                store.updateSlideContent(idx, { textBoxes: boxes });
              }}
              title="Add a text box to the slide"
            >
              + Text Box
            </button>
            <button
              onClick={() => {
                const store = usePresentationStore.getState();
                const idx = store.currentSlideIndex;
                const s = store.presentation.slides[idx];
                const arrows = [...(s.content.arrows || [])];
                arrows.push({
                  id: crypto.randomUUID(),
                  x1: 400,
                  y1: 400,
                  x2: 800,
                  y2: 400,
                  color: '#e53e3e',
                  strokeWidth: 4,
                  headSize: 16,
                });
                store.updateSlideContent(idx, { arrows });
              }}
              title="Add an annotation arrow to the slide"
            >
              + Arrow
            </button>
            {slide?.content.demo && (
              <span className="demo-label">Demo: {slide.content.demo}</span>
            )}
            {slide?.content.image && (
              <span className="demo-label">Image: {slide.content.image}</span>
            )}
          </div>
          <SlideEditor />
          <NotesPanel />
        </div>
      </div>
    </div>
  );
}

export default App;
