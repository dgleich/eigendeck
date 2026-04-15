import { useEffect, useState, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Toolbar } from './components/Toolbar';
import { SlideSidebar } from './components/SlideSidebar';
import { SlideEditor } from './components/SlideEditor';
import { PresentMode } from './components/PresentMode';
import { SpeakerMode } from './components/SpeakerMode';
import { openPresenterWindow } from './lib/multiMonitor';
import { NotesPanel } from './components/NotesPanel';
import { PropertiesPanel } from './components/PropertiesPanel';
import { HistoryPanel } from './components/HistoryPanel';
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
  importFromHtml,
  openRecentProject,
  syncRecentMenu,
} from './store/fileOps';
import { flushToSqlite } from './store/presentation';
import './App.css';

function App() {
  const { isPresenting, showProperties, showHistory } =
    usePresentationStore();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const clipboardRef = useRef<{ type: 'elements'; data: SlideElement[] } | { type: 'slide'; data: any } | null>(null);
  const [linkOverlayElementId, setLinkOverlayElementId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [multiMonitorPresenting, setMultiMonitorPresenting] = useState(false);

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

  // Initialize: open in-memory DB so assets work before first save, sync recent menu
  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('db_open_memory').catch(() => { /* may already have a DB open */ });
    }).catch(() => { /* not in Tauri */ });
    syncRecentMenu();
  }, []);

  // SQLite DB is closed from Rust via on_window_event(Destroyed) — no JS handler needed.

  // Warn before closing
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (usePresentationStore.getState().isDirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  // Start presenting — try multi-monitor first, fall back to single window
  const startPresenting = useCallback(async () => {
    const state = usePresentationStore.getState();
    try {
      console.log('[present] Attempting multi-monitor...');
      const opened = await openPresenterWindow(
        state.presentation,
        state.currentSlideIndex,
        state.projectPath
      );
      if (opened) {
        console.log('[present] Multi-monitor presenter opened');
        setMultiMonitorPresenting(true);
        state.setPresenting(true);
        return;
      }
      console.log('[present] No secondary monitor, using single-window');
    } catch (e) {
      console.log('[present] Multi-monitor not available:', e);
    }
    // Fallback: single-window fullscreen
    state.setPresenting(true);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); flushToSqlite().then(() => saveProject()); }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); usePresentationStore.temporal.getState().undo(); }
      if ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); usePresentationStore.temporal.getState().redo(); }
      const inEditable = !!(e.target as HTMLElement).closest('[contenteditable="true"]');
      // Cmd+I: italic when editing text (WebKit handles natively), inspector otherwise
      if (e.key.toLowerCase() === 'i' && (e.ctrlKey || e.metaKey) && !inEditable) { e.preventDefault(); usePresentationStore.getState().toggleProperties(); }
      // Cmd+E: center text (not handled natively by WebKit)
      if (inEditable && e.key.toLowerCase() === 'e' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); document.execCommand('justifyCenter'); }
      if (e.key === 'h' && (e.ctrlKey || e.metaKey) && e.shiftKey) { e.preventDefault(); usePresentationStore.getState().toggleHistory(); }
      if (e.key === 'F5') { e.preventDefault(); flushToSqlite().then(() => startPresenting()); }
      // Delete selected element
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const sel = usePresentationStore.getState().selectedObject;
        if (sel?.type === 'element') { e.preventDefault(); usePresentationStore.getState().deleteElement(sel.id); }
        if (sel?.type === 'multi') { e.preventDefault(); usePresentationStore.getState().deleteElements(sel.ids); }
      }
      // Duplicate element (Cmd+D)
      if (e.key === 'd' && (e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const state = usePresentationStore.getState();
        const sel = state.selectedObject;
        const slide = state.presentation.slides[state.currentSlideIndex];
        if (sel?.type === 'element') {
          e.preventDefault();
          const el = slide.elements.find((el) => el.id === sel.id);
          if (el) {
            const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID(), linkId: undefined, syncId: undefined, _linkId: undefined, _syncId: undefined };
            if (newEl.type === 'arrow') { newEl.x1 += 40; newEl.y1 += 40; newEl.x2 += 40; newEl.y2 += 40; }
            else { newEl.position = { ...newEl.position, x: newEl.position.x + 40, y: newEl.position.y + 40 }; }
            state.addElement(newEl);
            state.selectObject({ type: 'element', id: newEl.id });
          }
        } else if (sel?.type === 'multi') {
          e.preventDefault();
          const newIds: string[] = [];
          for (const id of sel.ids) {
            const el = slide.elements.find((el) => el.id === id);
            if (el) {
              const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID(), linkId: undefined, syncId: undefined, _linkId: undefined, _syncId: undefined };
              if (newEl.type === 'arrow') { newEl.x1 += 40; newEl.y1 += 40; newEl.x2 += 40; newEl.y2 += 40; }
              else { newEl.position = { ...newEl.position, x: newEl.position.x + 40, y: newEl.position.y + 40 }; }
              state.addElement(newEl);
              newIds.push(newEl.id);
            }
          }
          if (newIds.length === 1) state.selectObject({ type: 'element', id: newIds[0] });
          else if (newIds.length > 1) state.selectObject({ type: 'multi', ids: newIds });
        }
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

  // Present button event
  useEffect(() => {
    const handler = () => { flushToSqlite().then(() => startPresenting()); };
    window.addEventListener('start-presenting', handler);
    return () => window.removeEventListener('start-presenting', handler);
  }, [startPresenting]);

  // Listen for presenter window closing (Escape in presenter)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen: tauriListen } = await import('@tauri-apps/api/event');
        unlisten = await tauriListen('presenter:closed', () => {
          setMultiMonitorPresenting(false);
          usePresentationStore.getState().setPresenting(false);
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
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
        case 'import-html': importFromHtml(); break;
        case 'present': startPresenting(); break;
        case 'inspector': usePresentationStore.getState().toggleProperties(); break;
        case 'history': usePresentationStore.getState().toggleHistory(); break;
        case 'debug-console': window.dispatchEvent(new CustomEvent('toggle-debug-console')); break;
      }
    });
    const unlistenRecent = listen<string>('menu-event-recent', (event) => {
      openRecentProject(event.payload);
    });
    return () => { unlisten.then((fn) => fn()); unlistenRecent.then((fn) => fn()); };
  }, []);

  if (isPresenting && multiMonitorPresenting) return <SpeakerMode />;
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
            <button title="Add arrow" onClick={() => store.addElement({ id: crypto.randomUUID(), type: 'arrow', x1: 400, y1: 400, x2: 800, y2: 400, position: { x: 0, y: 0, width: 0, height: 0 }, color: '#2563eb', strokeWidth: 4, headSize: 16 })}>+ Arrow</button>
            <button title="Add cover-up rectangle (white)" onClick={() => {
              const sel = store.selectedObject;
              const slide = store.presentation.slides[store.currentSlideIndex];
              let pos = { x: 200, y: 300, width: 600, height: 400 };
              if (sel?.type === 'element') {
                const el = slide.elements.find((e) => e.id === sel.id);
                if (el) pos = { ...el.position };
              }
              store.addElement({ id: crypto.randomUUID(), type: 'cover' as any, position: pos });
            }}>+ Cover</button>
            <button title="Add image from file" onClick={async () => {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({ title: 'Select Image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'] }] });
              if (!selected) return;
              const fullPath = selected as string;
              const fileName = fullPath.split('/').pop() || 'image.png';
              const relativePath = `images/${fileName}`;
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                const { readFile } = await import('@tauri-apps/plugin-fs');
                const bytes = await readFile(fullPath);
                const ext = fileName.split('.').pop()?.toLowerCase() || 'png';
                const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                await invoke('db_store_asset', { path: relativePath, data: Array.from(bytes), mimeType: mime });
              } catch (err) { console.error('Failed to store image:', err); }
              store.addElement({ id: crypto.randomUUID(), type: 'image', src: relativePath, position: { x: 360, y: 200, width: 1200, height: 680 } });
            }}>+ Image</button>
            <button title="Add demo HTML" onClick={async () => {
              const { open } = await import('@tauri-apps/plugin-dialog');
              const selected = await open({ title: 'Select Demo', filters: [{ name: 'HTML', extensions: ['html'] }] });
              if (!selected) return;
              const fullPath = selected as string;
              const fileName = fullPath.split('/').pop() || 'demo.html';
              const relativePath = `demos/${fileName}`;

              // Store demo HTML as SQLite asset
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                const { readFile, readTextFile } = await import('@tauri-apps/plugin-fs');
                const bytes = await readFile(fullPath);
                await invoke('db_store_asset', { path: relativePath, data: Array.from(bytes), mimeType: 'text/html' });

                // Check if this is a demo-piece demo
                const html = await readTextFile(fullPath);
                const pieceMatches = html.matchAll(/piece\s*===?\s*['"](\w+)['"]/g);
                const pieces = [...new Set([...pieceMatches].map(m => m[1]))];

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
                  store.addElement({ id: crypto.randomUUID(), type: 'demo', src: relativePath, position: { x: 80, y: 200, width: 1760, height: 700 } });
                }
              } catch (err) {
                console.error('Failed to add demo:', err);
              }
            }}>+ Demo</button>
          </div>
          <SlideEditor />
          <NotesPanel />
        </div>
        {showProperties && <PropertiesPanel />}
        {showHistory && <HistoryPanel />}
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
