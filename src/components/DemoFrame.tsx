import { useState, useRef, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { usePresentationStore } from '../store/presentation';
import { open, message } from '@tauri-apps/plugin-dialog';
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

  // Use Tauri's asset protocol to load local files in the webview
  let src: string | undefined;
  if (projectPath) {
    const fullPath = `${projectPath}/${demoPath}`;
    try {
      src = convertFileSrc(fullPath) + `?r=${reloadKey}`;
    } catch {
      // Fallback for dev/non-Tauri environments
      src = `${fullPath}?r=${reloadKey}`;
    }
  }

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
    if (!projectPath) {
      await message('Please save or open a project first (File > New or Open).', {
        title: 'No Project Open',
        kind: 'info',
      });
      return;
    }

    const selected = await open({
      title: 'Select Demo HTML File',
      defaultPath: `${projectPath}/demos`,
      filters: [{ name: 'HTML', extensions: ['html'] }],
    });
    if (!selected) return;

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
    <button onClick={handleAddDemo} title="Add demo to slide">
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
