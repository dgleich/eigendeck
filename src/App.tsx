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
import { WelcomeWindow } from './components/WelcomeWindow';
import { HistoryPanel } from './components/HistoryPanel';
import { DebugConsole } from './components/DebugConsole';
import { LinkOverlay } from './components/LinkOverlay';
import { ContextMenu } from './components/ContextMenu';
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog';
import { DebugMenu } from './debug';
import { ToastHost } from './components/ToastHost';
import { SettingsModal } from './components/SettingsModal';
import { CollisionDialog } from './components/CollisionDialog';
import type { MenuEntry } from './components/ContextMenu';
import { detachDelta, pasteElementDelta } from './lib/syncLink';
import { previewKey, loadPreviewDataUrl } from './lib/previewCache';
import { registerNotebookLifecycle } from './components/notebook/notebookLifecycle';
import { runCopyHook } from './lib/elementLifecycle';
import { loadOverlayFor } from './lib/useOverlay';
import { isOverlayEmpty, serializeOverlay, summarizeOverlay } from './lib/notebookOverlay';
import { PromoteChooser } from './components/PromoteChooser';
import { usePresentationStore } from './store/presentation';
import { createTextElement } from './types/presentation';
import type { SlideElement } from './types/presentation';
import { usePreference, getPreference } from './lib/preferences';
import { INSERT_ITEMS, INSERT_GROUP_ORDER } from './lib/insertItems';
import {
  saveProject,
  saveAsProject,
  openProject,
  createProject,
  exportPresentation,
  importFromHtml,
  openRecentProject,
  syncRecentMenu,
} from './store/fileOps';
import { flushToSqlite, pauseUndo, resumeUndo, undoWithNav, redoWithNav } from './store/presentation';
import './App.css';
import { resolveTheme, themeColorForPreset } from './lib/themes';
import { markAsEigendeck } from './lib/clipboard';
import { isCopyableAsset, copyAssetElement, clearInternalClip, pasteAssetElement, copyTextElementHtml } from './lib/elementClipboard';
import { TEXT_PRESET_STYLES, effectiveFontSize, textBackgroundCss, textShadowCss, textBoxShadowCss } from './types/presentation';
import { fontForPreset, fontFamilyForPreset, buildEmbeddedFontFacesCSS } from './lib/fonts';
import { getMissingAssets } from './lib/missingAssets';

// Wire built-in element types into the sync/link lifecycle registry once, at
// module load — before any free/merge action can fire.
registerNotebookLifecycle();

// Debug/automation seam: expose the store + write-through flush on window so
// headless E2E and live scripting can drive store actions and persist them
// through the real SQLite path. Dev/test only — NOT shipped in release builds
// and NOT a user-facing feature. This is a test hook, not the documented
// editing path (LLM-EDITING.md uses the offline `eigendeck-cli` against the
// file at rest). It installs when either holds:
//   • dev build (`import.meta.env.DEV`) — convenience while developing.
//   • `VITE_EIGENDECK_SEAM=1` baked into the build — used for the E2E dist.
// Both are compile-time constants, so a plain release build tree-shakes the
// install away entirely.
if (
  import.meta.env.DEV ||
  import.meta.env.VITE_EIGENDECK_SEAM === '1'
) {
  (window as unknown as { __eigendeck?: unknown }).__eigendeck = {
    store: usePresentationStore,
    flush: flushToSqlite,
    save: saveProject,   // flush + atomic save-in-place to the open file
    // Missing-source registry (#74) — lets E2E assert detect/relocate.
    missingAssets: () => getMissingAssets(),
    // Undo-gesture transaction helpers (#55) — lets E2E exercise the real
    // pause/resume the canvas drag + inspector sliders use.
    pauseUndo, resumeUndo,
    // Relocate-all-by-offset (#74) — E2E hook mirroring what AssetSection does
    // after the user picks one moved file.
    relocateByOffset: (skipAssetId: string, oldAbs: string, newAbs: string) =>
      import('./lib/watcherRegistry').then((m) =>
        m.relocateMissingByOffset(
          m.dirname(usePresentationStore.getState().projectPath || ''),
          skipAssetId, oldAbs, newAbs,
        )),
  };
}

/** Render a single slide to HTML for PDF/print export */
export function renderSlideForPrint(
  slide: import('./types/presentation').Slide,
  presentationTheme: string,
  imageCache: Map<string, string>,
  presentationConfig?: import('./types/presentation').PresentationConfig
): string {
  const W = 1920, H = 1080;
  const theme = resolveTheme(presentationTheme, slide.theme);
  const cfg = presentationConfig || {} as import('./types/presentation').PresentationConfig;
  let inner = '';
  for (const el of slide.elements) {
    const p = el.position;
    if (el.type === 'text') {
      const ps = TEXT_PRESET_STYLES[el.preset] || TEXT_PRESET_STYLES.body;
      const valign = el.verticalAlign || (el.preset === 'title' || el.preset === 'footnote' ? 'bottom' : undefined);
      const valignStyle = valign === 'middle' ? 'display:flex;flex-direction:column;justify-content:center;' :
                         valign === 'bottom' ? 'display:flex;flex-direction:column;justify-content:flex-end;' : '';
      const color = el.color || themeColorForPreset(theme, el.preset);
      const presetFontFamily = fontFamilyForPreset(fontForPreset(el.preset, slide, cfg), el.preset);
      // markAsEigendeck wraps el.html with the clipboard-marker comment
      // so a full-element copy from a browser viewing this exported page
      // round-trips through eigendeck paste with inline markup preserved.
      // Comment is invisible in render; partial sub-selections won't carry
      // it (browser copy only includes parent comments when the selection
      // spans them), so this benefits the common whole-paragraph copy case.
      const _effSize1 = effectiveFontSize(el, cfg);
      const _bg1 = textBackgroundCss(el);
      const _fx1 = textShadowCss(el, color);
      const _sh1 = textBoxShadowCss(el);
      const _rot1 = el.rotation ? `transform:rotate(${el.rotation}deg);` : '';
      inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;overflow:hidden;${_bg1 ? `background:${_bg1};` : ''}${_sh1 ? `box-shadow:${_sh1};` : ''}${_rot1}">` +
        `<div style="width:100%;height:100%;${valignStyle}">` +
        `<div style="font-family:${el.fontFamily || presetFontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${_effSize1}px;color:${color};line-height:1.3;padding:8px 12px;${_fx1 ? `text-shadow:${_fx1};` : ''}">${markAsEigendeck(el.html || '')}</div>` +
        `</div></div>`;
    } else if (el.type === 'image') {
      const src = imageCache.get(el.assetId);
      if (src) inner += `<img src="${src}" style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;object-fit:contain;" />`;
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
    } else if (el.type === 'video') {
      inner += `<div style="position:absolute;left:${p.x}px;top:${p.y}px;width:${p.width}px;height:${p.height}px;background:#000;display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-family:system-ui;">&#9654; Video</div>`;
    }
  }
  return `<div class="print-slide" style="width:${W}px;height:${H}px;position:relative;overflow:hidden;background:${theme.background};page-break-after:always;">${inner}</div>`;
}

/** Export slides as print-ready HTML: vector text + screenshots of demos */
/** Export all slides as a PDF of screenshots (direct .pdf file) */
async function exportPdfScreenshots() {
  const state = usePresentationStore.getState();
  const { presentation } = state;
  const W = 1920, H = 1080;

  const { save, message } = await import('@tauri-apps/plugin-dialog');
  const defaultName = `${presentation.title.replace(/[^a-zA-Z0-9]/g, '-') || 'Presentation'}.pdf`;
  const selected = await save({
    title: 'Export to PDF (Screenshots)',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (!selected) return;

  await message(
    'Eigendeck will capture a screenshot of each slide to build the PDF. ' +
    'Interactive demos are captured as static images of their current state. ' +
    'The view will flip through all slides briefly — this is normal.',
    { title: 'Export to PDF', kind: 'info' }
  );

  try {
    const { domToDataUrl } = await import('modern-screenshot');
    const originalSlideIndex = state.currentSlideIndex;

    usePresentationStore.getState().selectObject({ type: 'slide' });
    document.body.classList.add('pdf-capturing');

    const jpegImages: Uint8Array[] = [];

    for (let i = 0; i < presentation.slides.length; i++) {
      usePresentationStore.getState().selectSlide(i);
      await new Promise(r => setTimeout(r, 400));

      const canvas = document.querySelector('.slide-canvas') as HTMLElement;
      let bytes = new Uint8Array(0);
      if (canvas) {
        try {
          const dataUrl = await domToDataUrl(canvas, {
            width: W, height: H, scale: 1,
            style: { transform: 'none', transformOrigin: 'top left' },
          });
          // Convert to JPEG
          const img = new Image();
          await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); img.src = dataUrl; });
          const cvs = document.createElement('canvas');
          cvs.width = W; cvs.height = H;
          const ctx = cvs.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(img, 0, 0, W, H);
          const jpegUrl = cvs.toDataURL('image/jpeg', 0.92);
          const b64 = jpegUrl.split(',')[1];
          const binary = atob(b64);
          bytes = new Uint8Array(binary.length);
          for (let j = 0; j < binary.length; j++) bytes[j] = binary.charCodeAt(j);
        } catch (e) {
          console.warn(`Failed to capture slide ${i + 1}:`, e);
        }
      }
      jpegImages.push(bytes);
    }

    document.body.classList.remove('pdf-capturing');
    usePresentationStore.getState().selectSlide(originalSlideIndex);

    const pdf = buildPdf(jpegImages, W, H);
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(selected as string, pdf);
  } catch (e) {
    console.error('PDF screenshot export failed:', e);
  }
}

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
    s.elements.some(e => e.type === 'demo' || e.type === 'demo-piece' || e.type === 'video'));

  // Prefer the proactively-cached preview for each demo — no flip-through for
  // demos that already have one. Only the misses need a live capture.
  const demoScreenshots = new Map<string, string>(); // slideId:elementId → dataUrl
  if (hasDemos) {
    for (const slide of presentation.slides) {
      for (const el of slide.elements) {
        if (el.type === 'demo' || el.type === 'demo-piece' || el.type === 'video') {
          const cached = await loadPreviewDataUrl(previewKey(el));
          if (cached) demoScreenshots.set(`${slide.id}:${el.id}`, cached);
        }
      }
    }
  }
  const needsLiveCapture = presentation.slides.some(s =>
    s.elements.some(e => (e.type === 'demo' || e.type === 'demo-piece' || e.type === 'video')
      && !demoScreenshots.has(`${s.id}:${e.id}`)));

  if (needsLiveCapture) {
    await message(
      "Some demos don't have a cached preview yet and will be captured now — " +
      'the view will flip through those slides briefly.\n\n' +
      'Open the exported file in a browser and use Cmd+P to save as PDF.',
      { title: 'Export for Print', kind: 'info' }
    );
  }

  try {
    // Load image assets as data URLs (keyed by assetId).
    const imageCache = new Map<string, string>();
    const { invoke } = await import('@tauri-apps/api/core');
    for (const slide of presentation.slides) {
      for (const el of slide.elements) {
        if (el.type === 'image' && !imageCache.has(el.assetId)) {
          try {
            const meta = await invoke<{ mime_type: string | null; path: string | null } | null>(
              'db_get_asset_meta_by_id', { assetId: el.assetId },
            );
            const data = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId: el.assetId });
            const bytes = new Uint8Array(data);
            const ext = (meta?.path ?? '').split('.').pop()?.toLowerCase() || 'png';
            const mime = meta?.mime_type
              ?? (ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
            let binary = '';
            for (let k = 0; k < bytes.length; k += 8192) {
              binary += String.fromCharCode(...bytes.slice(k, k + 8192));
            }
            imageCache.set(el.assetId, `data:${mime};base64,${btoa(binary)}`);
          } catch { /* skip */ }
        }
      }
    }

    // Live-capture ONLY the demos with no cached preview (flip through just
    // those slides). Cached demos were already filled into demoScreenshots
    // above — the common case is an empty flip-through here.
    if (needsLiveCapture) {
      const { domToDataUrl } = await import('modern-screenshot');
      const originalSlideIndex = state.currentSlideIndex;
      usePresentationStore.getState().selectObject({ type: 'slide' });
      document.body.classList.add('pdf-capturing');

      for (let i = 0; i < presentation.slides.length; i++) {
        const slide = presentation.slides[i];
        const demoEls = slide.elements.filter(e =>
          (e.type === 'demo' || e.type === 'demo-piece' || e.type === 'video')
          && !demoScreenshots.has(`${slide.id}:${e.id}`));
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

    // Build print HTML: all positions in inches (11in wide, 6.1875in tall for 16:9)
    // Scale factor: 11in / 1920px for positions, same ratio for font sizes
    const S = 11 / 1920; // inches per pixel
    const px2in = (px: number) => (px * S).toFixed(4) + 'in';
    const px2pt = (px: number) => (px * S * 72).toFixed(1) + 'pt'; // for font sizes

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
          const fontSize = effectiveFontSize(el, presentation.config);
          const presetFontFamily = fontFamilyForPreset(fontForPreset(el.preset, slide, presentation.config), el.preset);
          const _fx2 = textShadowCss(el, color);
          const _rot2 = el.rotation ? `transform:rotate(${el.rotation}deg);` : '';
          inner += `<div style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};overflow:hidden;${_rot2}">` +
            `<div style="width:100%;height:100%;${valignStyle}">` +
            `<div style="font-family:${el.fontFamily || presetFontFamily};font-weight:${ps.fontWeight};font-style:${ps.fontStyle};font-size:${px2pt(fontSize)};color:${color};line-height:1.3;padding:${px2in(8)} ${px2in(12)};${_fx2 ? `text-shadow:${_fx2};` : ''}">${markAsEigendeck(el.html || '')}</div>` +
            `</div></div>`;
        } else if (el.type === 'image') {
          const src = imageCache.get(el.assetId);
          if (src) {
            const styles = [`position:absolute`, `left:${px2in(p.x)}`, `top:${px2in(p.y)}`, `width:${px2in(p.width)}`, `height:${px2in(p.height)}`, `object-fit:contain`];
            if ((el as any).shadow) styles.push('filter:drop-shadow(2px 4px 8px rgba(0,0,0,0.3))');
            if ((el as any).borderRadius) styles.push(`border-radius:${px2in((el as any).borderRadius)}`);
            if ((el as any).opacity != null && (el as any).opacity < 1) styles.push(`opacity:${(el as any).opacity}`);
            inner += `<img src="${src}" style="${styles.join(';')};" />`;
          }
        } else if (el.type === 'arrow') {
          const { x1, y1, x2, y2, color = '#2563eb', strokeWidth = 4, headSize = 16 } = el;
          const angle = Math.atan2(y2 - y1, x2 - x1);
          const ha = Math.PI / 6;
          // SVG uses viewBox in original coordinates, scaled by the container
          inner += `<svg viewBox="0 0 ${W} ${H}" style="position:absolute;top:0;left:0;width:100%;height:100%;overflow:visible;">` +
            `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${strokeWidth}"/>` +
            `<polygon points="${x2},${y2} ${x2 - headSize * Math.cos(angle - ha)},${y2 - headSize * Math.sin(angle - ha)} ${x2 - headSize * Math.cos(angle + ha)},${y2 - headSize * Math.sin(angle + ha)}" fill="${color}"/>` +
            `</svg>`;
        } else if (el.type === 'cover') {
          inner += `<div style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};background:${el.color || theme.background};"></div>`;
        } else if (el.type === 'demo' || el.type === 'demo-piece' || el.type === 'video') {
          const screenshot = demoScreenshots.get(`${slide.id}:${el.id}`);
          if (screenshot) {
            inner += `<img src="${screenshot}" style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};" />`;
          } else {
            inner += `<div style="position:absolute;left:${px2in(p.x)};top:${px2in(p.y)};width:${px2in(p.width)};height:${px2in(p.height)};background:#f8f8f8;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;color:#999;font-size:${px2pt(24)};font-family:system-ui;">Interactive Demo</div>`;
          }
        }
      }
      return `<div class="slide" style="background:${theme.background};">${inner}</div>`;
    });

    // Embed @font-face data URLs for fonts used by this presentation.
    const fontFacesCss = await buildEmbeddedFontFacesCSS(presentation);

    const printHtml = `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>${presentation.title}</title>
<meta name="robots" content="noindex">
<style>
${fontFacesCss}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: 'PT Sans', sans-serif; }
html, body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

@media print {
  @page { size: letter landscape; margin: 0; }
  .slide {
    width: 11in; height: 6.1875in;
    position: relative; overflow: hidden;
    box-sizing: border-box;
    break-after: page;
    margin-top: 1.15625in;
  }
  .slide:last-child { break-after: auto; }
}

@media screen {
  body { background: #e0e0e0; padding: 20px 0; }
  .slide {
    width: 11in; height: 6.1875in;
    position: relative; overflow: hidden;
    box-sizing: border-box;
    margin: 20px auto;
    box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  }
}
</style>
</head>
<body>
${slideHtmls.join('\n')}
</body>
</html>`;

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
  const { isPresenting, showProperties, showHistory, projectPath } =
    usePresentationStore();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const clipboardRef = useRef<{ type: 'elements'; data: SlideElement[]; fromSlideIndex: number; fromSlideId: string } | { type: 'slide'; data: any } | null>(null);
  const [linkOverlayElementId, setLinkOverlayElementId] = useState<string | null>(null);
  const [promoteCandidates, setPromoteCandidates] = useState<{ elementId: string; slideNo: number; summary: string }[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [multiMonitorPresenting, setMultiMonitorPresenting] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  // Which "+ Insert" buttons are hidden from the editor toolbar. The
  // Insert menu (native) always lists everything; this only declutters
  // the toolbar. See src/lib/insertItems.ts + Settings → Toolbar buttons.
  const [hiddenToolbarItems] = usePreference('hiddenToolbarItems');

  // ---- Insert actions -----------------------------------------------------
  // Single dispatch for both the toolbar buttons and the native Insert menu.
  // Each reads fresh store state via getState() so it's safe to call from the
  // menu-event listener (which captures the first-render closure).

  const addImageFromPicker = async () => {
    const store = usePresentationStore.getState();
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ title: 'Select Image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'pdf'] }] });
    if (!selected) return;
    const fullPath = selected as string;
    const relativePath = relPath(store.projectPath, fullPath);
    const ext = fullPath.split('.').pop()?.toLowerCase() || 'png';
    const mime = ext === 'svg' ? 'image/svg+xml'
      : ext === 'pdf' ? 'application/pdf'
      : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    let bytes: Uint8Array | null = null;
    let assetId: string | null = null;
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      bytes = await readFile(fullPath);
      // Picker insertion: track the source link so the file
      // watcher picks up edits to the original file on disk.
      // Routed through collision check; user may cancel.
      const { storeAssetWithCollisionCheck } = await import('./lib/assetInsert');
      const r = await storeAssetWithCollisionCheck({
        path: relativePath, data: bytes, mimeType: mime,
        externalPath: relativePath, externalMtime: null,
      });
      if (r.cancelled) return;
      assetId = r.assetId;
    } catch (err) { console.error('Failed to store image:', err); return; }
    if (!assetId) return;
    const { detectAssetKind } = await import('./lib/assetCache');
    const kind = detectAssetKind(relativePath, mime);
    store.addElement({
      id: crypto.randomUUID(), type: 'image',
      assetId,
      kind,
      position: { x: 360, y: 200, width: 1200, height: 680 },
    });
    if (kind === 'svg' && bytes) {
      const { handleSvgExternalRefs, invalidateRenderedAsset } = await import('./lib/assetRenderer');
      const updated = await handleSvgExternalRefs(bytes, relativePath, fullPath);
      if (updated) {
        const { invoke } = await import('@tauri-apps/api/core');
        // Embed snapshot clears the source link (no more watching).
        // Same assetId — embed is a new version of the same asset.
        await invoke('db_store_asset', { path: relativePath, data: Array.from(updated), mimeType: mime, externalPath: null, externalMtime: null, assetId });
        await invalidateRenderedAsset(assetId);
      }
    }
  };

  const addDemoFromPicker = async () => {
    const store = usePresentationStore.getState();
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ title: 'Select Demo', filters: [{ name: 'HTML', extensions: ['html'] }] });
    if (!selected) return;
    const fullPath = selected as string;
    const relativePath = relPath(store.projectPath, fullPath);
    // Store demo HTML as SQLite asset
    try {
      const { readFile, readTextFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(fullPath);
      // Demo HTML — pass externalPath so the file watcher subscribes
      // and the inspector's Watch toggle is meaningful.
      const { storeAssetWithCollisionCheck } = await import('./lib/assetInsert');
      const r = await storeAssetWithCollisionCheck({
        path: relativePath, data: bytes, mimeType: 'text/html',
        externalPath: relativePath, externalMtime: null,
      });
      if (r.cancelled) return;
      const assetId = r.assetId;

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
            piece, assetId,
            position: { x, y: 200, width, height: 720 },
          });
          x += width + 40;
        }
      } else {
        store.addElement({ id: crypto.randomUUID(), type: 'demo', assetId, position: { x: 80, y: 200, width: 1760, height: 720 } });
      }
    } catch (err) {
      console.error('Failed to add demo:', err);
    }
  };

  const addNotebookFromPicker = async () => {
    const store = usePresentationStore.getState();
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ title: 'Select Notebook', filters: [{ name: 'Notebook', extensions: ['ipynb'] }] });
    if (!selected) return;
    const fullPath = selected as string;
    const relativePath = relPath(store.projectPath, fullPath);
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(fullPath);
      // Track the source link so the file watcher reloads when the
      // user re-saves the notebook from JupyterLab.
      const { storeAssetWithCollisionCheck } = await import('./lib/assetInsert');
      const r = await storeAssetWithCollisionCheck({
        path: relativePath, data: bytes,
        mimeType: 'application/x-ipynb+json',
        externalPath: relativePath, externalMtime: null,
      });
      if (r.cancelled) return;
      store.addElement({
        id: crypto.randomUUID(), type: 'notebook',
        assetId: r.assetId,
        position: { x: 80, y: 200, width: 1760, height: 720 },
      });
    } catch (err) {
      console.error('Failed to add notebook:', err);
    }
  };

  const runInsert = (id: string) => {
    const store = usePresentationStore.getState();
    switch (id) {
      case 'title': store.addElement(createTextElement('title')); break;
      case 'body': store.addElement(createTextElement('body')); break;
      case 'textbox': store.addElement(createTextElement('textbox')); break;
      case 'note': store.addElement(createTextElement('annotation')); break;
      case 'footnote': store.addElement(createTextElement('footnote')); break;
      case 'hype': store.addElement(createTextElement('hype')); break;
      case 'arrow':
        store.addElement({ id: crypto.randomUUID(), type: 'arrow', x1: 400, y1: 400, x2: 800, y2: 400, position: { x: 0, y: 0, width: 0, height: 0 }, color: '#2563eb', strokeWidth: 4, headSize: 16 });
        break;
      case 'cover': {
        const sel = store.selectedObject;
        const slide = store.presentation.slides[store.currentSlideIndex];
        let pos = { x: 200, y: 320, width: 600, height: 400 };
        if (sel?.type === 'element') {
          const el = slide.elements.find((e) => e.id === sel.id);
          if (el) pos = { ...el.position };
        }
        store.addElement({ id: crypto.randomUUID(), type: 'cover' as any, position: pos });
        break;
      }
      case 'image': void addImageFromPicker(); break;
      case 'demo': void addDemoFromPicker(); break;
      case 'notebook': void addNotebookFromPicker(); break;
      case 'video': setVideoUrl(''); setVideoModalOpen(true); break;
    }
  };

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
    import('@tauri-apps/api/core').then(async ({ invoke }) => {
      // No boot-time in-memory DB (#66). Nothing edits or flushes before a
      // project is anchored (flushToSqlite no-ops without a db path, and the
      // editor is gated behind projectPath → the Welcome window shows), so we
      // open a real DB only when a deck is created/opened.
      // If launched by double-clicking / "open with" a .eigendeck (a Linux/
      // Windows arg or an early macOS Opened event), open it directly — this
      // sets projectPath, so the editor (not the Welcome window) renders.
      try {
        const path = await invoke<string | null>('take_launch_file');
        if (path) await openRecentProject(path);
      } catch (e) { console.error('[boot] take_launch_file failed:', e); }
    }).catch((e) => { console.error('[boot] tauri core import failed:', e); });
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

  // Active/inactive toolbar tint (matches macOS chrome). Toggle `window-inactive`
  // on <body>; CSS swaps --toolbar-bg → --toolbar-bg-inactive. Tauri's
  // onFocusChanged is authoritative; DOM focus/blur is a fallback.
  useEffect(() => {
    const setActive = (active: boolean) =>
      document.body.classList.toggle('window-inactive', !active);
    setActive(typeof document !== 'undefined' ? document.hasFocus() : true);
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) =>
        getCurrentWindow().onFocusChanged(({ payload }) => setActive(payload)))
      .then((u) => { unlisten = u; })
      .catch(() => { /* not in Tauri */ });
    const onFocus = () => setActive(true);
    const onBlur = () => setActive(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      unlisten?.();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

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

  // Handle close/quit request — show in-app confirmation modal if dirty.
  // The previous native message() dialog only supports a single OK button
  // (the buttons:{} field was silently ignored), which is why quit appeared
  // to do nothing — Cancel never reached the close path.
  const closingRef = useRef(false);
  const dialogInFlightRef = useRef(false);
  const [unsavedDialog, setUnsavedDialog] = useState<{ title: string; hasFile: boolean } | null>(null);
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        unlisten = await listen('check-close', async () => {
          if (closingRef.current) return;
          // Cmd+Q fires both the "quit" menu event AND a window
          // CloseRequested — both emit check-close. Drop duplicates while
          // we're already showing a dialog, otherwise NSAlerts stack up.
          if (dialogInFlightRef.current) return;
          dialogInFlightRef.current = true;
          try {
            const state = usePresentationStore.getState();
            if (!state.isDirty) {
              // Clean — quit immediately.
              closingRef.current = true;
              const { invoke } = await import('@tauri-apps/api/core');
              await invoke('force_quit');
              return;
            }
            const title = state.presentation.title || 'Untitled';
            const hasFile = !!state.projectPath;
            // Try the native macOS NSAlert first (3-button system dialog).
            // Falls back to the cross-platform in-app modal on non-mac.
            try {
              const { invoke } = await import('@tauri-apps/api/core');
              const result = await invoke<string>('show_unsaved_dialog', { title, hasFile });
              if (result === 'save') { handleUnsavedSave(); return; }
              if (result === 'discard') { handleUnsavedDiscard(); return; }
              if (result === 'cancel') return;
              // 'fallback' — fall through to in-app modal below.
            } catch (e) {
              console.warn('Native unsaved dialog failed, using modal:', e);
            }
            setUnsavedDialog({ title, hasFile });
          } finally {
            // Always release the guard so the next quit attempt is allowed
            // (e.g. if the user cancelled and now tries again).
            dialogInFlightRef.current = false;
          }
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleUnsavedSave = useCallback(async () => {
    setUnsavedDialog(null);
    try {
      await flushToSqlite();
      await saveProject();           // prompts for path if untitled
      // After save the store is clean; re-emit so we go through the quit path
      if (!usePresentationStore.getState().isDirty) {
        closingRef.current = true;
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('force_quit');
      }
      // If still dirty (user cancelled the Save As prompt), do nothing —
      // user is back in the editor; let them try again.
    } catch (e) {
      console.error('Save before quit failed:', e);
    }
  }, []);

  const handleUnsavedDiscard = useCallback(async () => {
    setUnsavedDialog(null);
    closingRef.current = true;
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('force_quit');
  }, []);

  const handleUnsavedCancel = useCallback(() => {
    setUnsavedDialog(null);
  }, []);

  // Start presenting — try projector mode (multi-monitor) first when enabled,
  // fall back to single window. The "Present will try projector mode" pref gates
  // whether we even look for a second display.
  const startPresenting = useCallback(async () => {
    const state = usePresentationStore.getState();
    if (getPreference('tryProjectorMode')) {
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
    } else {
      console.log('[present] Projector mode disabled by preference — single-window');
    }
    // Fallback: single-window fullscreen
    state.setPresenting(true);
  }, []);

  // Screen-share presentation: dual-window present on a SINGLE screen — opens the
  // live slide as a chromeless, non-fullscreen window (shareable over Zoom/Meet
  // without taking over the whole display) and shows the speaker view in the main
  // window. `skipWindow` (used by e2e) shows only the speaker view, no projector.
  const startScreenSharePresenting = useCallback(async (skipWindow = false) => {
    const state = usePresentationStore.getState();
    if (!skipWindow) {
      try {
        await openPresenterWindow(state.presentation, state.currentSlideIndex, state.projectPath, { windowed: true });
      } catch (e) {
        console.warn('[present] screen-share presenter window failed:', e);
      }
    }
    setMultiMonitorPresenting(true);
    state.setPresenting(true);
  }, []);

  // DEBUG: force the SINGLE-window live present, bypassing multi-monitor
  // detection entirely — the explicit counterpart to the 2-window test.
  const startPresentingSingle = useCallback(() => {
    setMultiMonitorPresenting(false);
    usePresentationStore.getState().setPresenting(true);
  }, []);

  // Window-event hooks: screen-share present (also used by e2e via skipWindow)
  // and the single-window debug present.
  useEffect(() => {
    const handler = (e: Event) => {
      const skip = !!(e as CustomEvent).detail?.skipWindow;
      flushToSqlite().then(() => startScreenSharePresenting(skip));
    };
    const single = () => flushToSqlite().then(() => startPresentingSingle());
    window.addEventListener('eigendeck:screen-share-present', handler);
    window.addEventListener('eigendeck:test-present-single', single);
    return () => {
      window.removeEventListener('eigendeck:screen-share-present', handler);
      window.removeEventListener('eigendeck:test-present-single', single);
    };
  }, [startScreenSharePresenting, startPresentingSingle]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const inEditable = !!(e.target as HTMLElement).closest('[contenteditable="true"]');
      if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); flushToSqlite().then(() => saveProject()); }
      // Undo/redo: while editing a text box, let the BROWSER do native
      // character-level undo/redo — people expect Cmd+Z to undo their TYPING,
      // not jump out and undo a slide-level action. The store-level undo/redo
      // only applies outside text editing (the text edit commits as one store
      // step on blur, which the store undo then handles). (#55 / text undo)
      if (!inEditable && e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); undoWithNav(); }
      if (!inEditable && ((e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) || (e.key === 'y' && (e.ctrlKey || e.metaKey)))) { e.preventDefault(); redoWithNav(); }
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
            const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID(), ...detachDelta() };
            if (newEl.type === 'arrow') { newEl.x1 += 40; newEl.y1 += 40; newEl.x2 += 40; newEl.y2 += 40; }
            else { newEl.position = { ...newEl.position, x: newEl.position.x + 40, y: newEl.position.y + 40 }; }
            state.addElement(newEl);
            void runCopyHook(el, newEl);   // carry recording/state to the copy
            state.selectObject({ type: 'element', id: newEl.id });
          }
        } else if (sel?.type === 'multi') {
          e.preventDefault();
          const newIds: string[] = [];
          for (const id of sel.ids) {
            const el = slide.elements.find((el) => el.id === id);
            if (el) {
              const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID(), ...detachDelta() };
              if (newEl.type === 'arrow') { newEl.x1 += 40; newEl.y1 += 40; newEl.x2 += 40; newEl.y2 += 40; }
              else { newEl.position = { ...newEl.position, x: newEl.position.x + 40, y: newEl.position.y + 40 }; }
              state.addElement(newEl);
              void runCopyHook(el, newEl);   // carry recording/state to the copy
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
          if (el) {
            clipboardRef.current = { type: 'elements', data: [JSON.parse(JSON.stringify(el))], fromSlideIndex: state.currentSlideIndex, fromSlideId: slide.id };
            // Asset elements (image/SVG) → system clipboard + cross-window
            // internal clip (carries bytes for cross-deck paste). Text elements
            // → system clipboard as rich HTML (paste into other apps). Either
            // way, clear the internal asset clip for non-asset copies.
            if (isCopyableAsset(el)) {
              void copyAssetElement(el);
            } else {
              void clearInternalClip();
              if (el.type === 'text') void copyTextElementHtml(el, slide, state.presentation.config, state.presentation.theme);
            }
          }
        } else if (sel?.type === 'multi') {
          clipboardRef.current = { type: 'elements', data: slide.elements
            .filter((el) => sel.ids.includes(el.id))
            .map((el) => JSON.parse(JSON.stringify(el))), fromSlideIndex: state.currentSlideIndex, fromSlideId: slide.id };
          void clearInternalClip();
        } else if (!sel || sel.type === 'slide') {
          clipboardRef.current = { type: 'slide', data: JSON.parse(JSON.stringify(slide)) };
          void clearInternalClip();
        }
      }
      // Paste (Cmd+V): handled by paste event listener below (not keydown)
      // so system clipboard images take priority over internal clipboard
    };
    window.addEventListener('keydown', handleKeyDown);
    // Internal element/slide paste — runs on the paste event so it doesn't
    // block the system clipboard (image paste in SlideEditor gets first pick)
    const handlePaste = async (e: ClipboardEvent) => {
      if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      // Capture (synchronously, before any await) whether the SYSTEM clipboard
      // carries an image — clipboardData is neutered after an await.
      let sysImage = false;
      if (e.clipboardData?.items) {
        for (const item of Array.from(e.clipboardData.items)) {
          if (item.type.startsWith('image/')) { sysImage = true; break; }
        }
      }
      // Asset round-trip (image/SVG) via the internal clip — works cross-deck
      // and cross-window, storing the bytes into THIS deck. Preferred over both
      // the system image and the in-app clipboardRef. Staleness-checked in Rust,
      // so a foreign copy after an eigendeck copy falls through to SlideEditor.
      const pastedAsset = await pasteAssetElement();
      if (pastedAsset) {
        e.preventDefault();
        const state = usePresentationStore.getState();
        const p = (pastedAsset as { position?: { x: number; y: number; width: number; height: number } }).position;
        if (p) (pastedAsset as { position: typeof p }).position = { ...p, x: p.x + 40, y: p.y + 40 };
        state.addElement(pastedAsset);
        state.selectObject({ type: 'element', id: pastedAsset.id });
        return;
      }
      // Foreign system image → let SlideEditor handle it.
      if (sysImage) return;
      const clip = clipboardRef.current;
      if (clip?.type === 'elements') {
        e.preventDefault();
        const state = usePresentationStore.getState();
        const targetSlide = state.presentation.slides[state.currentSlideIndex];
        // Same slide if we're pasting back onto the slide we copied from (by id,
        // so slide reordering doesn't fool it).
        const sameSlide = targetSlide?.id === clip.fromSlideId;
        // The source slide (where the originals still live) — for cross-slide
        // linking. Located by id; may be gone if the slide was deleted.
        const srcSlideIdx = state.presentation.slides.findIndex((s) => s.id === clip.fromSlideId);

        const newIds: string[] = [];
        const toLink: Array<{ pastedId: string; sourceId: string }> = [];
        for (const el of clip.data) {
          // Same slide → independent copy; cross-slide → join the source's sync
          // group (if synced) else link to the source (animation). See
          // pasteElementDelta + docs/sync-and-link.md.
          const { delta, link } = pasteElementDelta(el, sameSlide);
          const newEl = { ...JSON.parse(JSON.stringify(el)), id: crypto.randomUUID(), ...delta };
          // Offset only the same-slide independent copy so it doesn't stack.
          if (sameSlide) {
            if (newEl.type === 'arrow') { newEl.x1 += 40; newEl.y1 += 40; newEl.x2 += 40; newEl.y2 += 40; }
            else { newEl.position = { ...newEl.position, x: newEl.position.x + 40, y: newEl.position.y + 40 }; }
          }
          state.addElement(newEl);
          newIds.push(newEl.id);
          // Carry type-specific state across (e.g. clone a notebook's
          // recording). No-op when the copy joined the source's sync group
          // (same overlay key → already shares it).
          void runCopyHook(el, newEl);
          // Link to the source only if it still exists on the source slide.
          if (link && srcSlideIdx >= 0
              && state.presentation.slides[srcSlideIdx].elements.some((s) => s.id === el.id)) {
            toLink.push({ pastedId: newEl.id, sourceId: el.id });
          }
        }
        // Link cross-slide pastes to their sources (shared linkId on both).
        for (const { pastedId, sourceId } of toLink) {
          usePresentationStore.getState().linkElements(pastedId, srcSlideIdx, sourceId);
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

  // Promote an animation link → sync. Destructive, so: if the linked notebooks
  // hold DIFFERENT recordings, raise a chooser to pick which one survives (the
  // picked copy becomes the master); otherwise confirm and promote, keeping the
  // single recording if there is one.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail?.elementId as string | undefined;
      if (!id) return;
      void (async () => {
        const st = usePresentationStore.getState();
        const clicked = st.presentation.slides.flatMap((s) => s.elements).find((x) => x.id === id);
        if (!clicked || !clicked.linkId || clicked.syncId) return;
        const linkId = clicked.linkId;
        // Notebook members of the link group, with their slide number + overlay key.
        const members: { elementId: string; slideNo: number; key: string }[] = [];
        st.presentation.slides.forEach((s, i) => s.elements.forEach((el) => {
          if (el.linkId === linkId && el.type === 'notebook') {
            members.push({ elementId: el.id, slideNo: i + 1, key: el.syncId ?? el.id });
          }
        }));
        const withRec: { elementId: string; slideNo: number; sig: string; summary: string }[] = [];
        for (const m of members) {
          const ov = await loadOverlayFor(m.key);
          if (!isOverlayEmpty(ov)) withRec.push({ elementId: m.elementId, slideNo: m.slideNo, sig: serializeOverlay(ov), summary: summarizeOverlay(ov) });
        }
        const distinct = new Set(withRec.map((r) => r.sig));
        if (distinct.size >= 2) {
          // Real conflict → let the user choose which recording to keep.
          setPromoteCandidates(withRec.map((r) => ({ elementId: r.elementId, slideNo: r.slideNo, summary: r.summary })));
          return;
        }
        // No conflict: master = the sole recording's holder (so it's kept), else the clicked one.
        const masterId = withRec.length === 1 ? withRec[0].elementId : id;
        if (confirm('Promote this animation link to a sync?\n\nThe linked copies become one element (same position and content). This is hard to undo.')) {
          usePresentationStore.getState().promoteToSync(masterId);
        }
      })();
    };
    window.addEventListener('promote-to-sync', handler);
    return () => window.removeEventListener('promote-to-sync', handler);
  }, []);

  // Native menu events
  useEffect(() => {
    const unlisten = listen<string>('menu-event', (event) => {
      // Native "Insert" menu items (always available, ignore toolbar
      // visibility) — route through the shared insert dispatcher.
      if (event.payload.startsWith('insert-')) {
        runInsert(event.payload.slice('insert-'.length));
        return;
      }
      switch (event.payload) {
        case 'new-project': createProject(); break;
        case 'open-project': openProject(); break;
        case 'save': saveProject(); break;
        case 'save-as': saveAsProject(); break;
        case 'export': exportPresentation(); break;
        case 'export-pdf': printToPdf(); break;
        case 'export-pdf-screenshots': exportPdfScreenshots(); break;
        case 'import-html': importFromHtml(); break;
        case 'present': startPresenting(); break;
        case 'screen-share-present': flushToSqlite().then(() => startScreenSharePresenting()); break;
        case 'test-present-single': flushToSqlite().then(() => startPresentingSingle()); break;
        case 'inspector': usePresentationStore.getState().toggleProperties(); break;
        case 'history': usePresentationStore.getState().toggleHistory(); break;
        case 'toggle-snap-grid': usePresentationStore.getState().toggleSnapToGrid(); break;
        case 'toggle-show-grid': usePresentationStore.getState().toggleShowGrid(); break;
        case 'toggle-decorations': (async () => {
          try {
            const { getCurrentWindow } = await import('@tauri-apps/api/window');
            const win = getCurrentWindow();
            const current = await win.isDecorated();
            await win.setDecorations(!current);
          } catch (e) {
            // Was failing silently when the window capability wasn't granted
            // (needs core:window:allow-set-decorations). Surface it now.
            console.error('Toggle window chrome failed:', e);
            const { showToast } = await import('./lib/toasts');
            showToast({ message: `Couldn't toggle window chrome: ${e}`, kind: 'error' });
          }
        })(); break;
        case 'debug-console': window.dispatchEvent(new CustomEvent('toggle-debug-console')); break;
        case 'settings':
          setSettingsOpen(true);
          break;
        case 'presentation-settings':
        case 'deck-properties': {
          const s = usePresentationStore.getState();
          if (!s.showProperties) s.toggleProperties();
          s.setInspectorTab('presentation');
          break;
        }
        case 'slide-properties': {
          const s = usePresentationStore.getState();
          if (!s.showProperties) s.toggleProperties();
          s.setInspectorTab('slide');
          break;
        }
        case 'slide-new': usePresentationStore.getState().addSlide(); break;
        case 'slide-duplicate': {
          const s = usePresentationStore.getState();
          s.duplicateSlide(s.currentSlideIndex);
          break;
        }
        case 'slide-delete': {
          const s = usePresentationStore.getState();
          s.deleteSlide(s.currentSlideIndex);
          break;
        }
        case 'paste-plain':
          navigator.clipboard.readText().then((text) => {
            document.execCommand('insertText', false, text);
          }).catch(() => {});
          break;
        case 'gc-assets': (async () => {
          try {
            // Flush any pending writes first so dirty elements don't
            // get classified as orphan-bound before their assetId binding
            // lands in the DB.
            await flushToSqlite();
            const { dbGcAssets } = await import('./store/db');
            const { showToast } = await import('./lib/toasts');
            const r = await dbGcAssets();
            const mb = (r.bytesFreed / (1024 * 1024)).toFixed(2);
            const msg = r.removedAssets === 0
              ? 'No unused assets — nothing to free.'
              : `Freed ${mb} MB · removed ${r.removedAssets} unused asset${r.removedAssets === 1 ? '' : 's'} (${r.removedVersions} version${r.removedVersions === 1 ? '' : 's'}).`;
            showToast({ message: msg, kind: 'success' });
          } catch (e) {
            console.error('gc-assets failed:', e);
            const { showToast } = await import('./lib/toasts');
            showToast({ message: `Compact failed: ${e}`, kind: 'error' });
          }
        })(); break;
      }
    });
    const unlistenRecent = listen<string>('menu-event-recent', (event) => {
      openRecentProject(event.payload);
    });
    // Warm open: app already running and the OS handed us a file — single
    // instance (Linux/Win) or RunEvent::Opened (macOS) pushes it here.
    // Routes through the same safe teardown as Open Recent.
    const unlistenOpenFile = listen<string>('open-file', (event) => {
      openRecentProject(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
      unlistenRecent.then((fn) => fn());
      unlistenOpenFile.then((fn) => fn());
    };
  }, []);

  if (isPresenting && multiMonitorPresenting) return <SpeakerMode />;
  if (isPresenting) return <PresentMode />;
  // No project open → welcome screen (issue #66). Editing only begins once a
  // deck is anchored on disk, so file-watching / linked assets work from the
  // start. Launching with a file arg sets projectPath before this renders.
  if (!projectPath) return (<><ToastHost /><WelcomeWindow /></>);

  const store = usePresentationStore.getState();

  const addVideoFromFile = async () => {
    const { open, confirm } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ title: 'Select Video', filters: [{ name: 'Video', extensions: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'ogg'] }] });
    if (!selected) return;
    const fullPath = selected as string;
    const relativePath = relPath(store.projectPath, fullPath);
    const ext = fullPath.split('.').pop()?.toLowerCase() || 'mp4';
    const mime = ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime'
      : ext === 'm4v' ? 'video/x-m4v' : (ext === 'ogv' || ext === 'ogg') ? 'video/ogg' : 'video/mp4';
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs');
      const bytes = await readFile(fullPath);
      const mb = bytes.length / (1024 * 1024);
      if (mb > 250) {
        const ok = await confirm(`This video is ${mb.toFixed(0)} MB. It will be embedded in the deck file, making it large. Continue?`, { title: 'Large video', kind: 'warning' });
        if (!ok) return;
      }
      const { storeAssetWithCollisionCheck } = await import('./lib/assetInsert');
      const r = await storeAssetWithCollisionCheck({ path: relativePath, data: bytes, mimeType: mime, externalPath: relativePath, externalMtime: null });
      if (r.cancelled) return;
      store.addElement({ id: crypto.randomUUID(), type: 'video', kind: 'file', assetId: r.assetId, controls: true, position: { x: 360, y: 200, width: 1200, height: 680 } });
    } catch (err) { console.error('Failed to add video:', err); }
  };

  const addVideoFromUrl = async (raw: string) => {
    const url = raw.trim();
    const { detectVideoProvider } = await import('./lib/videoEmbed');
    const parsed = detectVideoProvider(url);
    if (!parsed) {
      const { message } = await import('@tauri-apps/plugin-dialog');
      await message('Unrecognized video URL. Supported: YouTube, Vimeo, PeerTube.', { title: 'Add Video', kind: 'warning' });
      return;
    }
    store.addElement({ id: crypto.randomUUID(), type: 'video', kind: 'embed', provider: parsed.provider, url, controls: true, position: { x: 360, y: 200, width: 1200, height: 680 } });
  };

  return (
    <div className="app">
      <DebugMenu />
      <ToastHost />
      <Toolbar />
      <div className="main-area">
        <div style={{ width: sidebarWidth, minWidth: 150, maxWidth: 400, flexShrink: 0 }}>
          <SlideSidebar />
        </div>
        <div className="sidebar-resize-handle" onPointerDown={handleResizeStart} />
        <div className="editor-area">
          <div className="editor-actions">
            {INSERT_GROUP_ORDER.map((group) => {
              const items = INSERT_ITEMS.filter(
                (it) => it.group === group && !hiddenToolbarItems.includes(it.id));
              if (items.length === 0) return null;
              return (
                <div className="tb-group" key={group}>
                  {items.map((it) => (
                    <button key={it.id} title={it.tooltip} onClick={() => runInsert(it.id)}>
                      + {it.label}
                    </button>
                  ))}
                </div>
              );
            })}
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
      {promoteCandidates && (
        <PromoteChooser
          candidates={promoteCandidates}
          onPick={(elementId) => { usePresentationStore.getState().promoteToSync(elementId); setPromoteCandidates(null); }}
          onCancel={() => setPromoteCandidates(null)}
        />
      )}
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      {videoModalOpen && (
        <div onClick={() => setVideoModalOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 8, padding: 20, width: 420, boxShadow: '0 8px 32px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Add Video</div>
            <button className="prop-zbtn" style={{ width: 'auto', padding: '6px 10px', fontSize: 13 }}
              onClick={() => { setVideoModalOpen(false); void addVideoFromFile(); }}>Choose a video file…</button>
            <div style={{ fontSize: 12, color: '#888', textAlign: 'center' }}>or paste a URL</div>
            <input autoFocus type="text" value={videoUrl} placeholder="YouTube / Vimeo / PeerTube URL"
              onChange={(e) => setVideoUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && videoUrl.trim()) { setVideoModalOpen(false); void addVideoFromUrl(videoUrl); } }}
              style={{ padding: '6px 8px', fontSize: 13, border: '1px solid #ccc', borderRadius: 4 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="prop-zbtn" style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
                onClick={() => setVideoModalOpen(false)}>Cancel</button>
              <button className="prop-zbtn" style={{ width: 'auto', padding: '5px 10px', fontSize: 13, background: '#2563eb', color: '#fff' }}
                disabled={!videoUrl.trim()}
                onClick={() => { setVideoModalOpen(false); void addVideoFromUrl(videoUrl); }}>Add URL</button>
            </div>
          </div>
        </div>
      )}
      <CollisionDialog />
      {unsavedDialog && (
        <UnsavedChangesDialog
          title={unsavedDialog.title}
          hasFile={unsavedDialog.hasFile}
          onSave={handleUnsavedSave}
          onDiscard={handleUnsavedDiscard}
          onCancel={handleUnsavedCancel}
        />
      )}
    </div>
  );
}

export default App;
