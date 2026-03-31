import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { SlideSidebar } from './components/SlideSidebar';
import { SlideEditor } from './components/SlideEditor';
import { PresentMode } from './components/PresentMode';
import { AddDemoButton, RemoveDemoButton } from './components/DemoFrame';
import { NotesPanel } from './components/NotesPanel';
import { usePresentationStore } from './store/presentation';
import { saveProject } from './store/fileOps';
import './App.css';

function App() {
  const { isPresenting, presentation, currentSlideIndex } =
    usePresentationStore();

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
            {slide?.content.demo && (
              <span className="demo-label">Demo: {slide.content.demo}</span>
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
