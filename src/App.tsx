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
import { resolveTheme, themeColorForPreset } from './lib/themes';
import { TEXT_PRESET_STYLES } from './types/presentation';

/** Render a single slide to HTML for PDF/print export */
export function renderSlideForPrint(slide: import('./types/presentation').Slide, presentationTheme: string, imageCache: Map<string, string>): string {
  const W = 1920, H = 1080;
  const theme = resolveTheme(presentationTheme, slide.theme);
  let inner = '';
  for (const el of slide.elements) {
    const p = el.position;
    if (el.type === 'text') {
      const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
      const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
      const valignStyle = valign === 'middle' ? 'display:flex;flex-direction:column;justify-content:center;' :
                         valign === 'bottom' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';
      const color = el.color || themeColorForPreset(theme, el.preset);
      inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;overflow:hidden;">` +
        `<div style="width:100%;height:100%;${valignStyle}">` +
        `<div style="font-family:${el.fontFamily || ps.fontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${el.fontSize || ps.fontSize}px;color:${color};line-height:1.3;padding:8px 12px;">${el.html || ''}</div>` +
        `</div></div>`;
    } else if (el.type === 'image') {
      const src = imageCache.get(el.src) || el.src;
      inner += `<img src="${src}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;object-fit:contain;" />`;
    } else if (el.type === 'arrow') {
      const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16 } = el;
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const ha = Math.PI / 6;
      inner += `<svg style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;">` +
        `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}"/>` +
        `<polygon points="${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}" fill="${color}"/>` +
        `</svg>`;
    } else if (el.type === 'cover') {
      inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:${el.color || theme.background};"></div>`;
    } else if (el.type === 'demo' || el.type === 'demo-piece') {
      inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:#f8f8f8;border:2px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999;font-size:24px;font-family:system-ui;">Interactive Demo</div>`;
    }
  }
  return `<div class="print-slide" style="width:${W}px;height:${H}px;position:relative;overflow:hidden;background:${theme.background};page-break-after:always;">${inner}</div>`;
}

/** Export slides as print-ready HTML: vector text + screenshots of demos */
async function printToPdf() {
  const state = usePresentationStore.getState();
  const { presentation } = state;
  const W = 1920, H = 1080;

  const { save, message } = await import('@tauri-apps/plugin-dialog');
  const defaultName = `${presentation.title.replace(/[^a-zA-Z0-9]/g, '-') || 'Presentation'}-print.html`;
  const selected = await save({
    title: 'Export for Print',
    defaultPath: defaultName,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!selected) return;

  // Check if any slides have demos
  const hasDemos = presentation.slides.some(s =>
    s.elements.some(e => e.type === 'demo' || e.type === 'demo-piece'));

  if (hasDemos) {
    await message(
      'Interactive demos will be captured as static screenshots. ' +
      'The view will flip through slides with demos briefly — this is normal.\n\n' +
      'Open the exported file in a browser and use Cmd+P to save as PDF.',
      { title: 'Export for Print', kind: 'info' }
    );
  }

  try {
    // Load image assets as data URLs
    const imageCache = new Map<string, string>();
    const { invoke } = await import('@tauri-apps/api/core');
    for (const slide of presentation.slides) {
      for (const el of slide.elements) {
        if (el.type === 'image' && !el.src.startsWith('data:') && !imageCache.has(el.src)) {
          try {
            const data = await invoke<number[]>('db_get_asset', { path: el.src });
            const bytes = new Uint8Array(data);
            const ext = el.src.split('.').pop()?.toLowerCase() || 'png';
            const mime = ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
            let binary = '';
            for (let k = 0; k < bytes.length; k += 8192) {
              binary += String.fromCharCode(...bytes.slice(k, k + 8192));
            }
            imageCache.set(el.src, `data:${mime};base64,${btoa(binary)}`);
          } catch { /* skip */ }
        }
      }
    }

    // Capture screenshots of demo elements only
    const demoScreenshots = new Map<string, string>(); // slideId:elementId → dataUrl
    const slidesWithDemos = presentation.slides.filter(s =>
      s.elements.some(e => e.type === 'demo' || e.type === 'demo-piece'));

    if (slidesWithDemos.length > 0) {
      const { domToDataUrl } = await import('modern-screenshot');
      const originalSlideIndex = state.currentSlideIndex;
      usePresentationStore.getState().selectObject({ type: 'slide' });
      document.body.classList.add('pdf-capturing');

      for (let i = 0; i < presentation.slides.length; i++) {
        const slide = presentation.slides[i];
        const demoEls = slide.elements.filter(e => e.type === 'demo' || e.type === 'demo-piece');
        if (demoEls.length === 0) continue;

        usePresentationStore.getState().selectSlide(i);
        await new Promise(r => setTimeout(r, 500)); // Extra time for demos to render

        for (const el of demoEls) {
          const domEl = document.querySelector(`[data-element-id="${el.id}"]`) as HTMLElement;
          if (domEl) {
            try {
              const dataUrl = await domToDataUrl(domEl, {
                width: el.position.width, height: el.position.height, scale: 1,
              });
              demoScreenshots.set(`${slide.id}:${el.id}`, dataUrl);
            } catch (e) {
              console.warn(`Failed to capture demo ${el.id}:`, e);
            }
          }
        }
      }

      document.body.classList.remove('pdf-capturing');
      usePresentationStore.getState().selectSlide(originalSlideIndex);
    }

    // Build print HTML: vector text + demo screenshots
    const slideHtmls = presentation.slides.map((slide) => {
      const theme = resolveTheme(presentation.theme, slide.theme);
      let inner = '';
      for (const el of slide.elements) {
        const p = el.position;
        if (el.type === 'text') {
          const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
          const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
          const valignStyle = valign === 'middle' ? 'display:flex;flex-direction:column;justify-content:center;' :
                             valign === 'bottom' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';
          const color = el.color || themeColorForPreset(theme, el.preset);
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;overflow:hidden;">` +
            `<div style="width:100%;height:100%;${valignStyle}">` +
            `<div style="font-family:${el.fontFamily || ps.fontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${el.fontSize || ps.fontSize}px;color:${color};line-height:1.3;padding:8px 12px;">${el.html || ''}</div>` +
            `</div></div>`;
        } else if (el.type === 'image') {
          const src = imageCache.get(el.src) || el.src;
          const styles = [`position:absolute`, `left:${p.x}px`, `top:${p.y}px`, `width:${p.width}px`, `height:${p.height}px`, `object-fit:contain`];
          if ((el as any).shadow) styles.push('filter:drop-shadow(4px 8px 16px rgba(0,0,0,0.3))');
          if ((el as any).borderRadius) styles.push(`border-radius:${(el as any).borderRadius}px`);
          if ((el as any).opacity != null && (el as any).opacity < 1) styles.push(`opacity:${(el as any).opacity}`);
          inner += `<img src="${src}" style="${styles.join(';')};" />`;
        } else if (el.type === 'arrow') {
          const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16 } = el;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const ha = Math.PI / 6;
          inner += `<svg style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;">` +
            `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}"/>` +
            `<polygon points="${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}" fill="${color}"/>` +
            `</svg>`;
        } else if (el.type === 'cover') {
          inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:${el.color || theme.background};"></div>`;
        } else if (el.type === 'demo' || el.type === 'demo-piece') {
          const screenshot = demoScreenshots.get(`${slide.id}:${el.id}`);
          if (screenshot) {
            inner += `<img src="${screenshot}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;" />`;
          } else {
            inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:#f8f8f8;border:2px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999;font-size:24px;font-family:system-ui;">Interactive Demo</div>`;
          }
        }
      }
      return `<div class="print-slide"><div class="print-slide-inner" style="background:${theme.background};">${inner}</div></div>`;
    });

    const printHtml = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${presentation.title}</title>
<meta name="robots" content="noindex">
<style>
@import url('https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400&family=PT+Sans+Narrow:wght@400;700&display=swap');
@page { size: landscape; margin: 0; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { margin: 0; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { font-family: 'PT Sans', sans-serif; background: #e0e0e0; }
.print-slide {
  /* 960x540 = 1920x1080 at 0.5 scale = 10in x 5.625in */
  width: 960px; height: 540px;
  position: relative; overflow: hidden;
  page-break-after: always;
}
.print-slide:last-child { page-break-after: auto; }
.print-slide-inner {
  position: absolute; top: 0; left: 0;
  width: ${W}px; height: ${H}px;
  transform-origin: top left;
  transform: scale(0.5);
}
@media screen {
  .print-slide { margin: 30px auto; box-shadow: 0 2px 12px rgba(0,0,0,0.3); }
}
@media print {
  body { background: #fff; }
  .print-slide { margin: 0 auto; }
}
</style>
</head><body>
${slideHtmls.join('\n')}
</body></html>`;

    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(selected as string, printHtml);
  } catch (e) {
    console.error('PDF export failed:', e);
  }
}

/** Build a minimal PDF from JPEG images (one per page) */
/** @internal — kept for future direct PDF export */
export function buildPdf(images: Uint8Array[], pageW: number, pageH: number): Uint8Array {
  // PDF uses points (72 per inch). Scale 1920x1080 to fit standard proportions.
  const ptW = 1920 * 0.5; // 960pt = ~13.3in
  const ptH = 1080 * 0.5; // 540pt = ~7.5in

  const encoder = new TextEncoder();
  const parts: (Uint8Array | string)[] = [];
  const offsets: number[] = [];
  let pos = 0;

  function write(s: string) { parts.push(s); pos += encoder.encode(s).length; }
  function writeBin(b: Uint8Array) { parts.push(b); pos += b.length; }
  function objStart(id: number) { offsets[id] = pos; write(`${id} 0 obj\n`); }

  write('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');

  // Object 1: Catalog
  objStart(1);
  write('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');

  // Object 2: Pages (references all page objects)
  const pageObjStart = 3;
  const firstImageObj = pageObjStart + images.length;
  objStart(2);
  const kids = images.map((_, i) => `${pageObjStart + i} 0 R`).join(' ');
  write(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>\nendobj\n`);

  // Page objects and image objects
  for (let i = 0; i < images.length; i++) {
    const pageObj = pageObjStart + i;
    const imgObj = firstImageObj + i;
    const imgBytes = images[i];

    // Page object
    objStart(pageObj);
    if (imgBytes.length > 0) {
      // Page with image
      const contentsObj = firstImageObj + images.length + i;
      write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] ` +
        `/Resources << /XObject << /Img${i} ${imgObj} 0 R >> >> ` +
        `/Contents ${contentsObj} 0 R >>\nendobj\n`);
    } else {
      // Blank page (failed capture)
      write(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ptW} ${ptH}] >>\nendobj\n`);
    }
  }

  // Image XObjects
  for (let i = 0; i < images.length; i++) {
    const imgObj = firstImageObj + i;
    const imgBytes = images[i];
    if (imgBytes.length === 0) { objStart(imgObj); write('<< >>\nendobj\n'); continue; }

    objStart(imgObj);
    write(`<< /Type /XObject /Subtype /Image /Width ${pageW} /Height ${pageH} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
    writeBin(imgBytes);
    write('\nendstream\nendobj\n');
  }

  // Content streams (draw image on each page)
  for (let i = 0; i < images.length; i++) {
    const contentsObj = firstImageObj + images.length + i;
    if (images[i].length === 0) { objStart(contentsObj); write('<< /Length 0 >>\nstream\nendstream\nendobj\n'); continue; }
    const stream = `q ${ptW} 0 0 ${ptH} 0 0 cm /Img${i} Do Q`;
    objStart(contentsObj);
    write(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  }

  // Cross-reference table
  const xrefPos = pos;
  const totalObjs = firstImageObj + images.length * 2;
  write(`xref\n0 ${totalObjs + 1}\n`);
  write('0000000000 65535 f \n');
  for (let i = 1; i <= totalObjs; i++) {
    const off = offsets[i] || 0;
    write(`${String(off).padStart(10, '0')} 00000 n \n`);
  }

  write(`trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\n`);
  write(`startxref\n${xrefPos}\n%%EOF\n`);

  // Concatenate all parts
  let totalLen = 0;
  for (const p of parts) totalLen += typeof p === 'string' ? encoder.encode(p).length : p.length;
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    const bytes = typeof p === 'string' ? encoder.encode(p) : p;
    result.set(bytes, offset);
    offset += bytes.length;
  }
  return result;
}

/** Compute relative path from eigendeck's directory to a file */
export function relPath(projectPath: string | null, fullPath: string): string {
  if (!projectPath) return fullPath.split('/').pop() || 'file';
  const dir = projectPath.replace(/\/[^/]+$/, '');
  const dirParts = dir.split('/');
  const fileParts = fullPath.split('/');
  // Find common prefix
  let common = 0;
  while (common < dirParts.length && common < fileParts.length && dirParts[common] === fileParts[common]) {
    common++;
  }
  // Build relative path: ../ for each remaining dir part, then remaining file parts
  const ups = dirParts.length - common;
  const rel = [...Array(ups).fill('..'), ...fileParts.slice(common)].join('/');
  return rel || fullPath.split('/').pop() || 'file';
}

function App() {
  const { isPresenting, showProperties, showHistory } =
    usePresentationStore();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const clipboardRef = useRef<{ type: 'elements'; data: SlideElement[]; fromSlideIndex: number } | { type: 'slide'; data: any } | null>(null);
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

  // Initialize: open in-memory DB, sync recent menu, restore window position
  useEffect(() => {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('db_open_memory').catch(() => { /* may already have a DB open */ });
    }).catch(() => { /* not in Tauri */ });
    syncRecentMenu();
    // Restore saved window position/size
    (async () => {
      try {
        const saved = localStorage.getItem('eigendeck-window-bounds');
        if (!saved) return;
        const { x, y, width, height } = JSON.parse(saved);
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        await win.setPosition(new (await import('@tauri-apps/api/dpi')).LogicalPosition(x, y));
        await win.setSize(new (await import('@tauri-apps/api/dpi')).LogicalSize(width, height));
      } catch { /* not in Tauri or invalid saved data */ }
    })();
  }, []);

  // SQLite DB is closed from Rust via on_window_event(Destroyed) — no JS handler needed.

  // Save window position/size on move/resize (debounced)
  useEffect(() => {
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    const saveWindowBounds = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const win = getCurrentWindow();
        const pos = await win.outerPosition();
        const size = await win.outerSize();
        const factor = await win.scaleFactor();
        localStorage.setItem('eigendeck-window-bounds', JSON.stringify({
          x: Math.round(pos.x / factor), y: Math.round(pos.y / factor),
          width: Math.round(size.width / factor), height: Math.round(size.height / factor),
        }));
      } catch { /* not in Tauri */ }
    };
    const debouncedSave = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveWindowBounds, 500);
    };
    window.addEventListener('resize', debouncedSave);
    // Also save periodically in case of move without resize
    const interval = setInterval(saveWindowBounds, 30000);
    return () => {
      window.removeEventListener('resize', debouncedSave);
      clearInterval(interval);
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, []);

  // Handle close/quit request — show confirmation if dirty
  const closingRef = useRef(false);
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('check-close', async () => {
          if (closingRef.current) return;
          if (usePresentationStore.getState().isDirty) {
            const { message: showMessage } = await import('@tauri-apps/plugin-dialog');
            const result = await showMessage('You have unsaved changes.', {
              title: 'Unsaved Changes',
              kind: 'warning',
              buttons: {
                ok: 'Close without Saving',
                cancel: 'Cancel',
              },
            });
            if (result !== 'Ok') return;
          }
          // Force quit via Rust — avoids CloseRequested loop
          closingRef.current = true;
          const { invoke } = await import('@tauri-apps/api/core');
          await invoke('force_quit');
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
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
      if (inEditable && (e.ctrlKey || e.metaKey)) {
        const key = e.key.toLowerCase();
        if (key === 'b') { e.preventDefault(); document.execCommand('bold'); }
        if (key === 'i') { e.preventDefault(); document.execCommand('italic'); }
        if (key === 'e') { e.preventDefault(); document.execCommand('justifyCenter'); }
        // Cmd+Shift+V: paste as plain text (strip formatting)
        if (key === 'v' && e.shiftKey) {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => {
            document.execCommand('insertText', false, text);
          }).catch(() => {});
        }
      }
      // Cmd+I outside text: toggle inspector
      if (e.key.toLowerCase() === 'i' && (e.ctrlKey || e.metaKey) && !inEditable) { e.preventDefault(); usePresentationStore.getState().toggleProperties(); }
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
      if (e.key === 'c' && (e.ctrlKey || e.metaKey) && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !inEditable) {
        const state = usePresentationStore.getState();
        const sel = state.selectedObject;
        const slide = state.presentation.slides[state.currentSlideIndex];
        if (sel?.type === 'element') {
          const el = slide.elements.find((el) => el.id === sel.id);
          if (el) clipboardRef.current = { type: 'elements', data: [JSON.parse(JSON.stringify(el))], fromSlideIndex: state.currentSlideIndex };
        } else if (sel?.type === 'multi') {
          clipboardRef.current = { type: 'elements', data: slide.elements
            .filter((el) => sel.ids.includes(el.id))
            .map((el) => JSON.parse(JSON.stringify(el))), fromSlideIndex: state.currentSlideIndex };
        } else if (!sel || sel.type === 'slide') {
          clipboardRef.current = { type: 'slide', data: JSON.parse(JSON.stringify(slide)) };
        }
      }
      // Paste (Cmd+V): handled by paste event listener below (not keydown)
      // so system clipboard images take priority over internal clipboard
    };
    window.addEventListener('keydown', handleKeyDown);
    // Internal element/slide paste — runs on the paste event so it doesn't
    // block the system clipboard (image paste in SlideEditor gets first pick)
    const handlePaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      // If system clipboard has an image, let SlideEditor handle it
      if (e.clipboardData?.items) {
        for (const item of Array.from(e.clipboardData.items)) {
          if (item.type.startsWith('image/')) return;
        }
      }
      const clip = clipboardRef.current;
      if (clip?.type === 'elements') {
        e.preventDefault();
        const state = usePresentationStore.getState();
        const newIds: string[] = [];
        const sameSlide = clip.fromSlideIndex === state.currentSlideIndex;
        for (const el of clip.data) {
          const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID() };
          // Only offset when pasting on the same slide (avoid stacking)
          if (sameSlide) {
            if (newEl.type === 'arrow') {
              newEl.x1 += 40; newEl.y1 += 40; newEl.x2 += 40; newEl.y2 += 40;
            } else {
              newEl.position = { ...newEl.position, x: newEl.position.x + 40, y: newEl.position.y + 40 };
            }
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
    };
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
    };
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
        case 'export-pdf': printToPdf(); break;
        case 'import-html': importFromHtml(); break;
        case 'present': startPresenting(); break;
        case 'inspector': usePresentationStore.getState().toggleProperties(); break;
        case 'history': usePresentationStore.getState().toggleHistory(); break;
        case 'toggle-decorations': (async () => {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const win = getCurrentWindow();
          const current = await win.isDecorated();
          await win.setDecorations(!current);
        })(); break;
        case 'debug-console': window.dispatchEvent(new CustomEvent('toggle-debug-console')); break;
        case 'paste-plain':
          navigator.clipboard.readText().then((text) => {
            document.execCommand('insertText', false, text);
          }).catch(() => {});
          break;
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
              const relativePath = relPath(store.projectPath, fullPath);
              try {
                const { invoke } = await import('@tauri-apps/api/core');
                const { readFile } = await import('@tauri-apps/plugin-fs');
                const bytes = await readFile(fullPath);
                const ext = fullPath.split('.').pop()?.toLowerCase() || 'png';
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
              const relativePath = relPath(store.projectPath, fullPath);

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
