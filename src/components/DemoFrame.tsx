import { useState, useRef, useCallback } from 'react';
import { usePresentationStore } from '../store/presentation';
import { open } from '@tauri-apps/plugin-dialog';
import type { DemoPosition } from '../types/presentation';

interface DemoFrameProps {
  demoPath: string;
  position?: DemoPosition;
}

export function DemoFrame({ demoPath, position }: DemoFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { projectPath } = usePresentationStore();

  const reload = useCallback(() => {
    setReloadKey((k) => k + 1);
  }, []);

  const pos = position || { x: 0, y: 200, width: 800, height: 400 };

  // Build the src URL for the iframe
  // In Tauri, we can use convertFileSrc or just a file:// path
  const src = projectPath
    ? `${projectPath}/${demoPath}?r=${reloadKey}`
    : undefined;

  return (
    <div
      className="demo-frame-container"
      style={{
        position: 'absolute',
        left: pos.x,
        top: pos.y,
        width: pos.width,
        height: pos.height,
      }}
    >
      {src && (
        <iframe
          ref={iframeRef}
          key={reloadKey}
          src={src}
          sandbox="allow-scripts allow-same-origin"
          style={{ border: 'none', width: '100%', height: '100%' }}
          title={demoPath}
        />
      )}
      <button className="demo-reload-btn" onClick={reload} title="Reload demo">
        Reload
      </button>
    </div>
  );
}

export function AddDemoButton() {
  const { currentSlideIndex, updateSlideContent, projectPath } =
    usePresentationStore();

  const handleAddDemo = async () => {
    if (!projectPath) return;

    const selected = await open({
      title: 'Select Demo HTML File',
      defaultPath: `${projectPath}/demos`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!selected) return;

    // Make the path relative to the project
    const fullPath = selected as string;
    const relativePath = fullPath.startsWith(projectPath)
      ? fullPath.slice(projectPath.length + 1)
      : fullPath;

    updateSlideContent(currentSlideIndex, {
      demo: relativePath,
      demoPosition: { x: 80, y: 200, width: 800, height: 400 },
    });
  };

  return (
    <button onClick={handleAddDemo} disabled={!projectPath} title="Add demo to slide">
      + Demo
    </button>
  );
}

export function RemoveDemoButton() {
  const { presentation, currentSlideIndex, updateSlideContent } =
    usePresentationStore();

  const slide = presentation.slides[currentSlideIndex];
  if (!slide?.content.demo) return null;

  return (
    <button
      onClick={() =>
        updateSlideContent(currentSlideIndex, {
          demo: undefined,
          demoPosition: undefined,
        })
      }
      title="Remove demo from slide"
    >
      - Demo
    </button>
  );
}
