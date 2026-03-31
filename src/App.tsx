import { useEffect } from 'react';
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
        <SlideSidebar />
        <div className="editor-area">
          <div className="editor-actions">
            <AddDemoButton />
            <RemoveDemoButton />
            <AddImageButton />
            <RemoveImageButton />
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
