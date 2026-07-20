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
import { openSettingsWindow } from './lib/settingsWindow';
import { useAggregateServerHealth } from './lib/serverHealth';
import { invokeSafe } from './lib/tauriInvoke';
import { flushAllOverlays } from './lib/overlayFlushRegistry';
import { useEscapeKey } from './lib/useEscapeKey';
import { nudgeDelta, zOrderDirection } from './lib/keyboardShortcuts';
import { dispatchToolbarAction } from './lib/toolbarActions';
import { CollisionDialog } from './components/CollisionDialog';
import type { MenuEntry } from './components/ContextMenu';
import { detachDelta } from './lib/syncLink';
import { offsetElement } from './lib/offsetElement';
import { buildPrintSlideHtml } from './lib/printSlideHtml';
import { previewKey, loadPreviewDataUrl, isPreviewThemeStale } from './lib/previewCache';
import { resolveTheme, previewThemeSalt } from './lib/themes';
import { registerNotebookLifecycle } from './components/notebook/notebookLifecycle';
import { runCopyHook } from './lib/elementLifecycle';
import { loadOverlayFor } from './lib/useOverlay';
import { isOverlayEmpty, serializeOverlay, summarizeOverlay } from './lib/notebookOverlay';
import { PromoteChooser } from './components/PromoteChooser';
import { usePresentationStore } from './store/presentation';
import { createTextElement, boxShadowExtents } from './types/presentation';
import { askConfirm } from './lib/confirmDialog';
import type { SlideElement } from './types/presentation';
import { usePreference, getPreference } from './lib/preferences';
import { INSERT_ITEMS, INSERT_GROUP_ORDER } from './lib/insertItems';
import {
  saveProject,
  saveAsProject,
  openProject,
  createProject,
  exportPresentation,
  buildPresentationExportHtml,
  importFromHtml,
  importHtmlToDeck,
  openRecentProject,
  syncRecentMenu,
} from './store/fileOps';
import { flushToSqlite, undoWithNav, redoWithNav, getDeckToken } from './store/presentation';
import { withBusy } from './store/busy';
import { BusyOverlay } from './components/BusyOverlay';
import './App.css';
import { readFileNative, readTextFileNative, writeFileNative, writeTextFileNative } from './lib/nativeFs';
import { bytesToBase64 } from './lib/base64';
import { extractDemoPieceNames } from './lib/demoPieces';
import { isCopyableAsset, copyAssetElement, clearInternalClip, pasteAssetElement, textElementClipboardHtml } from './lib/elementClipboard';
import { encodeClipHtml } from './lib/clipboardModel';
import { linkPastedToSource } from './lib/pasteClip';
import { eventInTextEditor } from './lib/editableTarget';
import { PasteAsModal } from './components/PasteAsModal';
import type { PasteRep } from './lib/pasteAs';
import { buildEmbeddedFontFacesCSS, fontForPreset } from './lib/fonts';
import { renderMathInHtml, containsMath } from './lib/mathjaxRenderer';
import { getMissingAssets } from './lib/missingAssets';

// Wire built-in element types into the sync/link lifecycle registry once, at
// module load — before any free/merge action can fire.
registerNotebookLifecycle();

// Debug/automation seam: expose the store + write-through flush on window so
// headless E2E and live scripting can drive store actions and persist them
// through the real SQLite path. Dev/test only — NOT shipped in release builds
// and NOT a user-facing feature. This is a test hook, not the documented
// editing path (docs/LLM-EDITING.md uses the offline `eigendeck-cli` against the
// file at rest). It installs when either holds:
//   • dev build (`import.meta.env.DEV`) — convenience while developing.
//   • `VITE_EIGENDECK_SEAM=1` baked into the build — used for the E2E dist.
// Both are compile-time constants, so a plain release build tree-shakes the
// install away entirely.
//
// SEAM DISCIPLINE (see .claude/skills/eigendeck-e2e SKILL.md): the seam may ONLY
// bypass what WebDriver can't do — native Open/Save/picker dialogs and the read/
// save-in-place that stand in for them. NEVER put application logic behind the seam
// (trust/approve/relocate/etc.): that's a parallel path that passes while the real UI
// is broken. Drive the real controls instead (for a second window, switch WebDriver
// window handles). The security action-seams here are being retired for exactly this.
if (
  import.meta.env.DEV ||
  import.meta.env.VITE_EIGENDECK_SEAM === '1'
) {
  (window as unknown as { __eigendeck?: unknown }).__eigendeck = {
    store: usePresentationStore,
    flush: flushToSqlite,
    save: saveProject,   // flush + atomic save-in-place to the open file
    openSettings: () => openSettingsWindow(),  // opens the independent Settings window (E2E)
    // Interactive-HTML export builder (dialog-free) — lets E2E verify the real
    // invoke-backed export pipeline (notebook/preview/asset reads) end to end
    // without a native save dialog.
    exportHtml: () => {
      const s = usePresentationStore.getState();
      return buildPresentationExportHtml(s.presentation);
    },
    // Import-from-HTML (dialog-free) — runs the REAL read->decode(#164)->import->
    // save->open path minus the native open/save-as pickers, so E2E can verify a
    // real exported HTML re-imports into a correct deck (Unicode intact).
    importHtml: (htmlContent: string, savePath: string) => importHtmlToDeck(htmlContent, savePath),
    // Missing-source registry (#74) — lets E2E assert detect/relocate.
    missingAssets: () => getMissingAssets(),
    // Asset-security introspection (seam-only): report the current deck's trust state
    // and, per linked asset, the resolve/approve/read-gate decision. Lets spec probes
    // assert WHY a file is (not) watched, not just the resulting bytes.
    trustReport: async () => {
      const s = usePresentationStore.getState();
      const token = getDeckToken();
      const { isTrusted, isPathApproved, deckState } = await import('./lib/trustStore');
      // Raw ledger approvals (resolved paths) for THIS deck — lets cleanup probes
      // assert an orphaned path is actually gone, independent of current links.
      const ledgerApprovals = token ? (await deckState(token)).approvals : [];
      // Observe the REAL gate independently (call gatedExternalRead per row) rather than
      // deriving from buildDeckSecurityReport — the point of this seam is to let a probe
      // cross-check the report against the actual read gate, so it must NOT be a tautology.
      const { resolveAndGate } = await import('./lib/assetGate');
      const { gatedExternalRead, resolvePosixPath, dirname } = await import('./lib/watcherRegistry');
      const { invoke } = await import('@tauri-apps/api/core');
      const linked = (await invoke('db_list_linked_assets').catch(() => [])) as Array<{ external_path: string }>;
      const rows: unknown[] = [];
      for (const a of linked) {
        const abs = resolvePosixPath(dirname(s.projectPath || ''), a.external_path);
        const gate = await resolveAndGate(abs);
        rows.push({ ext: a.external_path, gateOk: gate.ok, reason: gate.reason, approved: (token && gate.canonicalPath) ? await isPathApproved(token, gate.canonicalPath) : false, read: (await gatedExternalRead(abs)).status });
      }
      return JSON.stringify({ token: token ?? null, trusted: token ? await isTrusted(token) : false, ledgerApprovals, rows });
    },
    // NOTE: asset-security actions (trust / approve / approve-folder / revoke) and
    // relocate are deliberately NOT seams — a probe must drive the REAL Security
    // window + AssetSection controls (see e2e/_ui.mjs and the seam-discipline note).
    // Action-seams here once masked a real trust-persistence bug; don't re-add them.
    // Cached element preview as a data URL (#86) — lets E2E verify a demo's
    // preview is RE-captured after a theme switch (the bytes must change).
    previewDataUrl: (key: string) => loadPreviewDataUrl(key),
    // In-page rasterization of any element → PNG data URL (modern-screenshot).
    // WebKitWebDriver's /screenshot command HANGS while present mode is mounted
    // (its full-screen compositing trips WebKitGTK's snapshot — full-page AND
    // element screenshots both stall), yet the webview itself rasterizes fine
    // (canvas/SVG work). This lets E2E capture present mode (and anything else)
    // headlessly without the WebDriver snapshot. (#29 verification path)
    captureElement: async (selector: string): Promise<string | null> => {
      const node = document.querySelector(selector) as HTMLElement | null;
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const { domToDataUrl } = await import('modern-screenshot');
      return domToDataUrl(node, { width: Math.round(r.width), height: Math.round(r.height), scale: 1 });
    },
  };
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
    await writeFileNative(selected as string, pdf);
  } catch (e) {
    console.error('PDF screenshot export failed:', e);
  }
}

async function printToPdf() {
  const state = usePresentationStore.getState();
  const { presentation } = state;

  const { save, message } = await import('@tauri-apps/plugin-dialog');
  const defaultName = `${presentation.title.replace(/[^a-zA-Z0-9]/g, '-') || 'Presentation'}-print.html`;
  const selected = await save({
    title: 'Export for Print',
    defaultPath: defaultName,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!selected) return;

  // "Live" element types baked into the PDF as static screenshots (they can't
  // be interactive in print). Notebook included (P0-2) — previously dropped.
  const isLiveElement = (t: string) =>
    t === 'demo' || t === 'demo-piece' || t === 'video' || t === 'notebook';

  // Check if any slides have live elements
  const hasDemos = presentation.slides.some(s =>
    s.elements.some(e => isLiveElement(e.type)));

  // Prefer the proactively-cached preview for each live element — no flip-through
  // for those that already have one. Only the misses need a live capture.
  const demoScreenshots = new Map<string, string>(); // slideId:elementId → dataUrl
  if (hasDemos) {
    for (const slide of presentation.slides) {
      for (const el of slide.elements) {
        if (!isLiveElement(el.type)) continue;
        // A notebook's cached preview only re-captures while its slide is mounted,
        // so a theme switch leaves the previews for OTHER slides stale. Skip a
        // theme-stale one here so it drops into the needsLiveCapture flip-through
        // below and gets re-rasterized with the live theme (#140).
        if (el.type === 'notebook') {
          const salt = previewThemeSalt(resolveTheme(presentation.theme, slide.theme));
          if (await isPreviewThemeStale(previewKey(el), salt)) continue;
        }
        const cached = await loadPreviewDataUrl(previewKey(el));
        if (cached) demoScreenshots.set(`${slide.id}:${el.id}`, cached);
      }
    }
  }
  const needsLiveCapture = presentation.slides.some(s =>
    s.elements.some(e => isLiveElement(e.type)
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
            // PDF-kind images can't inline as data:application/pdf in <img> —
            // use the pdfium-rasterized PNG (asset_cache), same as the editor.
            if (el.kind === 'pdf') {
              const { renderAsset } = await import('./lib/assetRenderer');
              const { ASSET_TIER } = await import('./lib/assetCache');
              await renderAsset({
                assetId: el.assetId, kind: 'pdf', variant: el.snapshotVariant ?? '_',
                maxWidth: ASSET_TIER.full, maxHeight: ASSET_TIER.full,
              });
              const buf = await invoke<ArrayBuffer>('db_get_asset_cache_bytes', {
                sourceId: el.assetId, variant: el.snapshotVariant ?? '_',
                width: ASSET_TIER.full, height: ASSET_TIER.full,
              });
              const cbytes = new Uint8Array(buf);
              if (cbytes.length) {
                imageCache.set(el.assetId, `data:image/png;base64,${bytesToBase64(cbytes)}`);
              }
              continue;
            }
            const meta = await invoke<{ mime_type: string | null; path: string | null } | null>(
              'db_get_asset_meta_by_id', { assetId: el.assetId },
            );
            const data = await invoke<ArrayBuffer>('db_get_asset_by_id', { assetId: el.assetId });
            const bytes = new Uint8Array(data);
            const ext = (meta?.path ?? '').split('.').pop()?.toLowerCase() || 'png';
            const mime = meta?.mime_type
              ?? (ext === 'svg' ? 'image/svg+xml' : `image/${ext === 'jpg' ? 'jpeg' : ext}`);
            imageCache.set(el.assetId, `data:${mime};base64,${bytesToBase64(bytes)}`);
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
          isLiveElement(e.type)
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

    // Pre-render math per text element. The print path builds plain HTML (not the
    // live SVG render), so $…$ has to be composited to inline SVG up front — the
    // same thing the GUI export's makeTextElementRenderer does via the iframe pool.
    // Keyed by `${slide.id}:${el.id}` (NOT el.id) because one element can appear
    // on multiple slides (a linked/shared element) with a DIFFERENT font per slide
    // — keying by el.id alone collides and every slide gets the last render.
    const mathHtmlByKey = new Map<string, string>();
    for (const slide of presentation.slides) {
      for (const el of slide.elements) {
        if (el.type === 'text' && el.html && containsMath(el.html)) {
          const bundleId = fontForPreset(el.preset, slide, presentation.config).id;
          const rendered = await renderMathInHtml(el.html, bundleId, presentation.config.mathPreamble || '')
            .catch(() => el.html as string);
          mathHtmlByKey.set(`${slide.id}:${el.id}`, rendered);
        }
      }
    }

    // Build print HTML: per-slide element rendering (all positions in inches)
    // lives in buildPrintSlideHtml — a pure, snapshot-gated seam (render-path #6).
    const slideHtmls = presentation.slides.map((slide, i) =>
      buildPrintSlideHtml(slide, presentation, imageCache, demoScreenshots, mathHtmlByKey, i + 1));

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

    await writeTextFileNative(selected as string, printHtml);
  } catch (e) {
    console.error('PDF export failed:', e);
  }
}

/** File → Install LLM Tools… — pick a folder, write the kit, reveal it. */
async function installLlmTools() {
  const { open, message } = await import('@tauri-apps/plugin-dialog');
  const selected = await open({
    directory: true,
    title: 'Choose where to install the LLM tools',
  });
  if (!selected) return; // cancelled
  const targetDir = selected as string;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const dir = await withBusy('Installing LLM tools…', () =>
      invoke<string>('install_llm_tools', { targetDir }));
    await message(
      `Installed the Eigendeck LLM tools to:\n\n${dir}\n\n` +
      'Point your AI coding agent (Claude Code, etc.) at this folder — start with AGENTS.md.',
      { title: 'Install LLM Tools', kind: 'info' },
    );
    try {
      const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
      await revealItemInDir(dir);
    } catch {
      try {
        const { openPath } = await import('@tauri-apps/plugin-opener');
        await openPath(dir);
      } catch { /* reveal is best-effort */ }
    }
  } catch (e) {
    console.error('Install LLM tools failed:', e);
    await message(`Could not install the LLM tools:\n\n${e}`, {
      title: 'Install LLM Tools', kind: 'error',
    });
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
  const { isPresenting, showProperties, showHistory, projectPath, isDirty } =
    usePresentationStore();
  const [sidebarWidth, setSidebarWidth] = useState(200);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  // The floating insert HUD overlays the canvas; publish its measured height as
  // --insert-hud-h on .editor-area so the canvas top-padding tracks it (the slide
  // clears the chips even when they wrap to 2-3 rows).
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const insertHudRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const hud = insertHudRef.current;
    const area = editorAreaRef.current;
    if (!hud || !area) return;
    const apply = () =>
      area.style.setProperty('--insert-hud-h', `${hud.offsetTop + hud.offsetHeight}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(hud);
    return () => ro.disconnect();
    // Depend on projectPath AND isPresenting: the editor-area (and the HUD) only
    // mount once a deck is open (welcome/launch gate) — with [] deps this ran while
    // both refs were still null, so --insert-hud-h was never set and the canvas kept
    // the fallback padding, overlapping the HUD's wrapped rows. Present mode fully
    // UNMOUNTS the editor (App returns <PresentMode/> early), so on Escape the HUD
    // remounts fresh; without isPresenting here the effect wouldn't re-run, the new
    // HUD would go unmeasured, and the fallback padding would overlap it again
    // (worst with the inspector open, which wraps the chips to extra rows).
  }, [projectPath, isPresenting]);
  const [linkOverlayElementId, setLinkOverlayElementId] = useState<string | null>(null);
  const [promoteCandidates, setPromoteCandidates] = useState<{ elementId: string; slideNo: number; summary: string }[] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; items: MenuEntry[] } | null>(null);
  const [multiMonitorPresenting, setMultiMonitorPresenting] = useState(false);
  // Whenever presenting ends (any path), clear the multi-monitor flag — otherwise a
  // screen-share whose projector window died without emitting presenter:closed leaves
  // it stuck true, and the NEXT plain present renders the SpeakerMode to the audience.
  useEffect(() => { if (!isPresenting) setMultiMonitorPresenting(false); }, [isPresenting]);
  // False until the boot-time launch-file check resolves. Gates the welcome
  // screen so a file-launch (double-click / open-with) goes straight to the
  // editor without flashing the intro screen first (see the init effect).
  const [launchChecked, setLaunchChecked] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  // Escape closes the video insert modal (in-app modal, no native Esc) — #120.
  useEscapeKey(videoModalOpen, () => setVideoModalOpen(false));
  // "Paste as…" chooser (Stage 4): null = closed; an array (possibly empty) = open.
  const [pasteAsReps, setPasteAsReps] = useState<PasteRep[] | null>(null);
  const openPasteAs = useCallback(async () => {
    const { gatherClipboardTypes, clipboardRepresentations } = await import('./lib/pasteAs');
    setPasteAsReps(clipboardRepresentations(await gatherClipboardTypes()));
  }, []);
  // Canvas context-menu "Paste as…" dispatches this DOM event (the native Edit
  // menu reaches openPasteAs via the Tauri menu-event path instead).
  useEffect(() => {
    const open = () => void openPasteAs();
    window.addEventListener('eigendeck:open-paste-as', open);
    return () => window.removeEventListener('eigendeck:open-paste-as', open);
  }, [openPasteAs]);
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
      const { storeAssetWithCollisionCheck } = await import('./lib/assetInsert');
      // Picker insertion: track the source link so the file
      // watcher picks up edits to the original file on disk.
      // Routed through collision check; user may cancel. A big image/PDF can
      // take a few seconds to read + embed — show the busy overlay.
      const r = await withBusy('Importing image…', async () => {
        bytes = await readFileNative(fullPath);
        return storeAssetWithCollisionCheck({
          path: relativePath, data: bytes, mimeType: mime,
          externalPath: relativePath, externalMtime: null,
        });
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
        const { storeAssetRaw } = await import('./lib/assetInsert');
        // Embed snapshot clears the source link (no more watching).
        // Same assetId — embed is a new version of the same asset.
        await storeAssetRaw({ path: relativePath, mimeType: mime, externalPath: null, externalMtime: null, assetId }, updated);
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
      const bytes = await readFileNative(fullPath);
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
      const html = await readTextFileNative(fullPath);
      const pieces = extractDemoPieceNames(html);

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
      const bytes = await readFileNative(fullPath);
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

  // Insert an HTML element from a .html snippet FILE (#137). Validates it's a
  // usable snippet first — the same gate a future "download from an online repo"
  // flow will use — and rejects cruddy input (not HTML, scripts, remote resources)
  // with a clear reason rather than silently inserting something that won't render.
  const addHtmlFromPicker = async () => {
    const store = usePresentationStore.getState();
    const { open, message } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ title: 'Insert HTML Element from File', filters: [{ name: 'HTML', extensions: ['html', 'htm'] }] });
    if (!selected) return;
    let raw: string;
    try {
      raw = await readTextFileNative(selected as string);
    } catch (err) {
      await message(`Couldn't read the file:\n${err}`, { title: 'Insert HTML Element', kind: 'error' });
      return;
    }
    const { validateHtmlSnippet } = await import('./lib/htmlSnippet');
    const v = validateHtmlSnippet(raw);
    if (!v.ok) {
      await message(`This file isn't a usable HTML element:\n\n• ${v.problems.join('\n• ')}`,
        { title: 'Insert HTML Element', kind: 'error' });
      return;
    }
    store.addElement({
      id: crypto.randomUUID(), type: 'html',
      position: { x: 560, y: 300, width: 800, height: 500 },
      html: v.html,
      ...(v.interactive ? { interactive: true } : {}),
    });
  };

  const runInsert = (id: string) => {
    const store = usePresentationStore.getState();
    switch (id) {
      case 'title': store.addElement(createTextElement('title')); break;
      case 'body': store.addElement(createTextElement('body')); break;
      case 'textbox': store.addElement(createTextElement('textbox')); break;
      case 'note': store.addElement(createTextElement('annotation')); break;
      case 'footnote': store.addElement(createTextElement('footnote')); break;
      case 'card': {
        // A "card" is just a text element (no new type): a bold, all-caps-spaced
        // title line + a body line, in a rounded, shadowed box whose fill is a
        // theme-relative accent tint (boxTint). #132.
        const el = createTextElement('body', { x: 660, y: 410, width: 600, height: 260 });
        store.addElement({
          ...el,
          html: '<div style="font-weight:700;text-transform:uppercase;letter-spacing:0.08em">Title</div><div>Card contents</div>',
          boxTint: 'accent',
          borderRadius: 30,
          boxShadow: true,
        });
        break;
      }
      case 'html':
        // Raw-HTML escape hatch (#137). Not in the toolbar — inserted from the
        // native Insert menu (or written programmatically by an LLM). Seeds a
        // placeholder that hints at both edit paths.
        store.addElement({
          id: crypto.randomUUID(), type: 'html',
          position: { x: 560, y: 340, width: 800, height: 400 },
          html: '<div style="font-family:system-ui;height:100%;display:flex;flex-direction:column;justify-content:center;gap:10px;padding:28px;border:2px dashed #c7d2fe;border-radius:18px;box-sizing:border-box">'
            + '<div style="font-size:42px;font-weight:700;color:#4f46e5">HTML element</div>'
            + '<div style="font-size:20px;color:#475569">Edit the raw HTML in the Inspector, or double-click to edit here (best effort).</div>'
            + '</div>',
        });
        break;
      case 'arrow':
        store.addElement({ id: crypto.randomUUID(), type: 'arrow', x1: 400, y1: 400, x2: 800, y2: 400, position: { x: 0, y: 0, width: 0, height: 0 }, color: '#2563eb', strokeWidth: 4, headSize: 16 });
        break;
      case 'cover': {
        const sel = store.selectedObject;
        const slide = store.presentation.slides[store.currentSlideIndex];
        let pos = { x: 200, y: 320, width: 600, height: 400 };
        if (sel?.type === 'element') {
          const el = slide.elements.find((e) => e.id === sel.id);
          if (el) {
            // Grow the mask past a card's box shadow so covering the card also hides
            // its shadow (a shadow paints outside the element box).
            const s = boxShadowExtents(el as { boxShadow?: boolean; backgroundColor?: string; boxTint?: string });
            pos = {
              x: el.position.x - s.left, y: el.position.y - s.top,
              width: el.position.width + s.left + s.right,
              height: el.position.height + s.top + s.bottom,
            };
          }
        }
        store.addElement({ id: crypto.randomUUID(), type: 'cover' as any, position: pos });
        break;
      }
      case 'image': void addImageFromPicker(); break;
      case 'demo': void addDemoFromPicker(); break;
      case 'notebook': void addNotebookFromPicker(); break;
      case 'html-file': void addHtmlFromPicker(); break;
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

  // Reflect the open file + dirty state onto the macOS title-bar proxy icon
  // (drag icon + filename + edited dot). no-op off macOS. See set_window_document.
  // projectPath is stored WITHOUT the .eigendeck extension (display convention),
  // but the represented file must be the REAL on-disk path or the proxy icon
  // drag fails with "document could not be found".
  useEffect(() => {
    const realPath = projectPath ? `${projectPath}.eigendeck` : null;
    void invokeSafe('set_window_document', { label: 'main', path: realPath, dirty: isDirty });
  }, [projectPath, isDirty]);

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
    })
      .catch((e) => { console.error('[boot] tauri core import failed:', e); })
      // Only after the launch-file check resolves do we know whether to show the
      // intro screen. Launched WITH a path → openRecentProject set projectPath
      // above, so the editor renders and the welcome screen never flashes.
      // Launched WITHOUT one (or on the web) → welcome screen.
      .finally(() => setLaunchChecked(true));
    syncRecentMenu();
    // Restore saved window position/size, THEN show the window. The main window
    // is created hidden (visible:false in tauri.conf) so the user never sees it
    // at the default spot before this repositions it — that was a visible jump
    // on launch. Always show in the finally, even with no saved bounds or an
    // error, so the window can't get stuck invisible.
    (async () => {
      let win: import('@tauri-apps/api/window').Window | null = null;
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        win = getCurrentWindow();
        const saved = localStorage.getItem('eigendeck-window-bounds');
        if (saved) {
          const { x, y, width, height } = JSON.parse(saved);
          const { LogicalPosition, LogicalSize } = await import('@tauri-apps/api/dpi');
          await win.setPosition(new LogicalPosition(x, y));
          await win.setSize(new LogicalSize(width, height));
        }
      } catch { /* not in Tauri or invalid saved data */ }
      finally {
        try { await win?.show(); } catch { /* not in Tauri */ }
      }
    })();
  }, []);

  // SQLite DB is closed from Rust via on_window_event(Destroyed) — no JS handler needed.

  // (Active/inactive window tint lives in src/lib/windowFocus.ts, wired centrally
  // by initRuntime so it runs in every window — not duplicated here.)

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
              // Clean — quit immediately. But a notebook run/edit can leave a
              // pending overlay that didn't mark the deck dirty, so force any
              // overlays to disk before we tear down the webview (#123). The
              // dirty branches flush via the save path (flushToSqlite); discard
              // deliberately does not.
              closingRef.current = true;
              await flushAllOverlays();
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

  // Native macOS NSToolbar (behind the mac-toolbar cargo feature) posts
  // `toolbar:action` events; route each to the SAME action as the HTML toolbar
  // button, so the two toolbars stay in lock-step. Harmless off macOS (the event
  // never fires). See src-tauri/src/mac_toolbar.rs + docs/mac-native-toolbar.md.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    // `cancelled` closes the async-registration race: this effect re-runs when
    // `startPresenting` settles after mount, and `listen()` resolves a tick LATER.
    // Without this guard the cleanup fires while `unlisten` is still undefined, so
    // the first listener is never removed and a second registers — every native
    // "Add Slide" click then fired addSlide TWICE (two slides). Now a cleanup that
    // beats the resolve marks it cancelled, and the late resolve unlistens itself.
    let cancelled = false;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ id: string }>('toolbar:action', ({ payload }) => {
        const store = usePresentationStore.getState();
        // Jupyter status icon → open Settings (Jupyter servers). Not a standard
        // insert/present action, so handle it before dispatchToolbarAction.
        if (payload.id === 'jupyter') { void openSettingsWindow('servers'); return; }
        dispatchToolbarAction(payload.id, {
          addSlide: () => store.addSlide(),
          addBuild: () => store.addBuildSlide(),
          present: () => void flushToSqlite().then(() => startPresenting()),
          save: () => void flushToSqlite().then(() => saveProject()),
          export: () => void exportPresentation(),
        });
      }).then((u) => { if (cancelled) u(); else unlisten = u; }),
    ).catch(() => {});
    return () => { cancelled = true; unlisten?.(); };
  }, [startPresenting]);

  // Native macOS toolbar Title/Author/Venue fields ↔ store (two-way).
  // Push current values into the fields whenever they change:
  const tbTitle = usePresentationStore((s) => s.presentation.title || '');
  const tbAuthor = usePresentationStore((s) => s.presentation.config.author || '');
  const tbVenue = usePresentationStore((s) => s.presentation.config.venue || '');
  // Window/document title tracks the deck + dirty state. Set here (not in the HTML
  // Toolbar) so it stays correct when that toolbar is hidden on native builds.
  useEffect(() => {
    document.title = `${tbTitle}${isDirty ? ' *' : ''} — Eigendeck`;
  }, [tbTitle, isDirty]);
  useEffect(() => {
    void invokeSafe('set_toolbar_fields', { title: tbTitle, author: tbAuthor, venue: tbVenue });
  }, [tbTitle, tbAuthor, tbVenue]);

  // On macOS with the native toolbar (mac-toolbar build), hide the HTML toolbar —
  // it duplicates the native one. False everywhere else (HTML toolbar stays).
  const [nativeToolbar, setNativeToolbar] = useState(false);
  useEffect(() => {
    void invokeSafe<boolean>('native_toolbar_active').then((v) => setNativeToolbar(!!v));
  }, []);

  // Native macOS toolbar Jupyter server-status icon — mirror the HTML pill's
  // aggregate health (green/yellow/red, gray = no live notebooks). Pushed to the
  // NSToolbar item; skipped off the native-toolbar build.
  const { status: jupyterStatus, tooltip: jupyterTooltip } = useAggregateServerHealth();
  useEffect(() => {
    if (!nativeToolbar) return;
    void invokeSafe('set_toolbar_jupyter', { status: jupyterStatus, tooltip: jupyterTooltip });
  }, [nativeToolbar, jupyterStatus, jupyterTooltip]);
  // Compact toolbar view (macOS native toolbar only): labels off + smaller icons.
  // Driven by the compactToolbar preference; applied live (no restart).
  const [compactToolbar] = usePreference('compactToolbar');
  useEffect(() => {
    if (!nativeToolbar) return;
    void invokeSafe('set_toolbar_compact', { compact: compactToolbar });
  }, [nativeToolbar, compactToolbar]);
  // Hide the native toolbar on the welcome screen (no project) and while
  // presenting; show it in the editor. no-op off the native-toolbar build.
  useEffect(() => {
    if (!nativeToolbar) return;
    void invokeSafe('set_toolbar_visible', { visible: !!projectPath && !isPresenting });
  }, [nativeToolbar, projectPath, isPresenting]);
  // Receive edits made IN the toolbar fields:
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<{ id: string; value: string }>('toolbar:field', ({ payload }) => {
        const s = usePresentationStore.getState();
        if (payload.id === 'title') s.setTitle(payload.value);
        else if (payload.id === 'author') s.updateConfig({ author: payload.value });
        else if (payload.id === 'venue') s.updateConfig({ venue: payload.value });
      }).then((u) => { unlisten = u; }),
    ).catch(() => {});
    return () => unlisten?.();
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
      // Plain Cmd/Ctrl+S only — don't swallow Save As (Shift+S) or Toggle Speaker
      // Notes (Alt+S), which are handled by the native menu accelerators.
      if (e.key === 's' && (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) { e.preventDefault(); flushToSqlite().then(() => saveProject()); }
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
      // Delete selected element. preventDefault is UNCONDITIONAL here (outside
      // editable fields): the webview treats a bare Backspace as history-back, so
      // pressing it with a slide selected (or nothing) navigated off the SPA and
      // blanked the app. Swallow it whenever we're not in a text field; the
      // sidebar handles slide deletion locally on its focused thumbnail.
      if ((e.key === 'Delete' || e.key === 'Backspace') && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName) && !(e.target as HTMLElement).closest('[contenteditable]')) {
        e.preventDefault();
        const sel = usePresentationStore.getState().selectedObject;
        if (sel?.type === 'element') usePresentationStore.getState().deleteElement(sel.id);
        else if (sel?.type === 'multi') usePresentationStore.getState().deleteElements(sel.ids);
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
            offsetElement(newEl, 40, 40);
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
              offsetElement(newEl, 40, 40);
              state.addElement(newEl);
              void runCopyHook(el, newEl);   // carry recording/state to the copy
              newIds.push(newEl.id);
            }
          }
          if (newIds.length === 1) state.selectObject({ type: 'element', id: newIds[0] });
          else if (newIds.length > 1) state.selectObject({ type: 'multi', ids: newIds });
        }
      }
      // Arrow keys: nudge the selected element(s) (1px / 10px with Shift), else
      // navigate slides (Up/Down) when nothing on the canvas is selected.
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight')
          && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)
          && !(e.target as HTMLElement).closest('[contenteditable]')) {
        const state = usePresentationStore.getState();
        const sel = state.selectedObject;
        const ids = sel?.type === 'element' ? [sel.id] : sel?.type === 'multi' ? sel.ids : null;
        const delta = nudgeDelta(e.key, e.shiftKey);
        if (ids && delta) {
          e.preventDefault();
          state.moveElementsBy(ids, delta.dx, delta.dy);
        } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (!sel || sel.type === 'slide')) {
          e.preventDefault();
          const idx = state.currentSlideIndex;
          const total = state.presentation.slides.length;
          if (e.key === 'ArrowUp' && idx > 0) state.selectSlide(idx - 1);
          if (e.key === 'ArrowDown' && idx < total - 1) state.selectSlide(idx + 1);
        }
      }
      // Z-order: Cmd+] / Cmd+[ (Shift → to front/back). Selected element only.
      if ((e.key === ']' || e.key === '[') && (e.ctrlKey || e.metaKey) && !inEditable
          && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        const state = usePresentationStore.getState();
        const sel = state.selectedObject;
        const dir = zOrderDirection(e.key, e.shiftKey);
        if (sel?.type === 'element' && dir) {
          e.preventDefault();
          state.moveElementZ(sel.id, dir);
        }
      }
      // Escape: deselect back to the slide (when not editing text).
      if (e.key === 'Escape' && !inEditable
          && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        const state = usePresentationStore.getState();
        if (state.selectedObject && state.selectedObject.type !== 'slide') {
          e.preventDefault();
          state.selectObject({ type: 'slide' });
        }
      }
      // Copy (Cmd+C): handled entirely by the 'copy' EVENT handler (handleCopy)
      // — it writes the private Eigendeck flavor + fallbacks to the OS clipboard.
      // Nothing on keydown (the old in-memory clipboardRef buffer is retired;
      // paste reads the private flavor live from the clipboard — see
      // docs/copy-and-paste.md).
      // Paste (Cmd+V): handled by paste event listener below (not keydown)
      // so system clipboard images take priority over internal clipboard
    };
    window.addEventListener('keydown', handleKeyDown);
    // Internal element/slide paste — runs on the paste event so it doesn't
    // block the system clipboard (image paste in SlideEditor gets first pick)
    const handlePaste = async (e: ClipboardEvent) => {
      // Bail when the caret is in a text editor. Checks focus/selection, not just
      // e.target — WebKit can dispatch a keyboard paste with target=<body> while
      // editing, which an e.target-only guard misses → double paste (element +
      // caret text). See editableTarget.ts.
      if (eventInTextEditor(e)) return;
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
        const el = pastedAsset.element;
        const link = pastedAsset.link;
        const curSlideId = state.presentation.slides[state.currentSlideIndex]?.id;
        // Offset ONLY for a same-slide paste (an independent copy sitting beside
        // the original). A cross-slide paste keeps the source coordinates so the
        // animation link interpolates in place — matching the element path
        // (pasteClip.ts), which offsets only when sameSlide. Offsetting here drifted
        // a linked image by 40px on the target slide.
        const sameSlide = !link.fromSlideId || curSlideId === link.fromSlideId;
        const p = (el as { position?: { x: number; y: number; width: number; height: number } }).position;
        if (p && sameSlide) (el as { position: typeof p }).position = { ...p, x: p.x + 40, y: p.y + 40 };
        state.addElement(el);
        state.selectObject({ type: 'element', id: el.id });
        // Cross-slide paste of an image → animation link to the source (same rule
        // as element paste; the metadata rode in the asset payload because
        // arboard's image write clobbers the html private flavor).
        if (link.sourceId && link.fromSlideId && !link.sourceSyncId && curSlideId !== link.fromSlideId) {
          linkPastedToSource(el.id, link.fromSlideId, link.sourceId);
        }
        return;
      }
      // Foreign system image → let SlideEditor handle it.
      if (sysImage) return;
    };
    window.addEventListener('paste', handlePaste);

    // SYSTEM-clipboard write happens on the 'copy' EVENT (race-free): for text,
    // setData('text/html') — the WebKit-reliable path; for image/SVG,
    // preventDefault so the browser doesn't clobber our native arboard write,
    // then copyAssetElement (system image + cross-window internal clip).
    const handleCopy = (e: ClipboardEvent) => {
      // A copy to the SYSTEM clipboard from editing a text element (or an
      // input/textarea) supersedes any prior element/slide copy. Clear our
      // internal buffer so a later CANVAS paste can't serve the STALE old
      // element — the "multiple clipboards" desync. The system clipboard is
      // authoritative after this; SlideElementRenderer's onCopy has already
      // written the selection there.
      if (eventInTextEditor(e)) {
        void clearInternalClip();
        return;
      }
      if (!e.clipboardData) return;
      const state = usePresentationStore.getState();
      const sel = state.selectedObject;
      const slide = state.presentation.slides[state.currentSlideIndex];
      if (!slide) return;

      // Write the PRIVATE Eigendeck flavor (element/slide JSON, base64 in
      // text/html) onto the OS clipboard for every copy, so paste reads an
      // internal copy back with full fidelity straight from the clipboard — no
      // separate buffer to desync (docs/copy-and-paste.md). `visibleHtml`/`plain`
      // are the foreign-app fallbacks.
      let clip: Parameters<typeof encodeClipHtml>[0] | null = null;
      let visibleHtml = '';
      let plain = '';
      let assetEl: SlideElement | null = null;

      if (sel?.type === 'element') {
        const el = slide.elements.find((x) => x.id === sel.id);
        if (el) {
          clip = { kind: 'elements', elements: [el], fromSlideId: slide.id, fromSlideIndex: state.currentSlideIndex };
          if (el.type === 'text') {
            const r = textElementClipboardHtml(el, slide, state.presentation.config, state.presentation.theme);
            visibleHtml = r.styledHtml; plain = r.plain;
          } else if (el.type === 'html') {
            // Raw-HTML element (#137): put its source on the clipboard as the
            // visible flavors, so it renders/pastes into foreign apps and shows
            // up as real content (not just the empty private-flavor wrapper).
            visibleHtml = (el as { html?: string }).html || '';
            plain = visibleHtml;
          }
          if (isCopyableAsset(el)) assetEl = el;
        }
      } else if (sel?.type === 'multi') {
        const els = slide.elements.filter((x) => sel.ids.includes(x.id));
        if (els.length) clip = { kind: 'elements', elements: els, fromSlideId: slide.id, fromSlideIndex: state.currentSlideIndex };
      } else if (!sel || sel.type === 'slide') {
        clip = { kind: 'slide', slide, fromSlideId: slide.id, fromSlideIndex: state.currentSlideIndex };
      }
      if (!clip) { void clearInternalClip(); return; }

      e.preventDefault();
      e.clipboardData.setData('text/html', encodeClipHtml(clip, visibleHtml));
      if (plain) e.clipboardData.setData('text/plain', plain);
      // Asset element: ALSO place the image bytes on the clipboard for foreign
      // paste (arboard). The link metadata rides in the asset payload since the
      // image write clobbers the text/html private flavor.
      if (assetEl) void copyAssetElement(assetEl, { fromSlideId: slide.id, fromSlideIndex: state.currentSlideIndex });
      else void clearInternalClip();
    };
    window.addEventListener('copy', handleCopy);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handlePaste);
      window.removeEventListener('copy', handleCopy);
    };
  }, []);

  // Present button event
  useEffect(() => {
    const handler = () => { flushToSqlite().then(() => startPresenting()); };
    window.addEventListener('start-presenting', handler);
    return () => window.removeEventListener('start-presenting', handler);
  }, [startPresenting]);

  // Demo host infra (relay + rAF pump) is armed by useDemoHost() in the components
  // that render demos (SlideEditor, PresentMode) — shared across the main AND
  // presenter windows, so no per-window wiring to forget. (docs/DEMO-PLATFORM.md §6, §16)

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

  // Asset-security: the Security window writes approvals to the shared ledger and
  // emits `eigendeck:security-changed`. This window owns the watcher, so re-scan the
  // deck's linked assets here — newly-approved paths now load + invalidate, so the
  // canvas/sidebar refresh without needing a reopen. (docs/ASSETS-SECURITY.md)
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unlistenReq: (() => void) | null = null;
    (async () => {
      try {
        const { listen: tauriListen, emitTo, emit: tauriEmit } = await import('@tauri-apps/api/event');
        unlisten = await tauriListen('eigendeck:security-changed', async () => {
          const store = usePresentationStore.getState();
          if (!store.projectPath) return;
          // The Security window (a separate webview with its own ledger cache) just
          // mutated the shared appData ledger — drop our stale cache so the re-scan
          // and subsequent gate reads see the new approvals/revocations.
          const { invalidateLedgerCache } = await import('./lib/trustStore');
          invalidateLedgerCache();
          const { scanForChangedAssets, dirname } = await import('./lib/watcherRegistry');
          const presOverride = store.presentation.config.autoReloadAssets ?? null;
          await scanForChangedAssets(dirname(store.projectPath), presOverride).catch(() => {});
        });
        // The Security window is a separate webview with its own store copy, so it can't
        // mutate the live deck (minting a token / flipping watch there never reaches the
        // deck file — the trust-persistence bug). It sends one `security:request` to THIS
        // (main) window, which owns the live deck: run the action, SAVE, then reinit()
        // re-sends the updated deck so the window rebuilds. One channel, one action switch.
        const reinit = async () => {
          const st = usePresentationStore.getState();
          await emitTo('security', 'security:init', { presentation: st.presentation, projectPath: st.projectPath });
          await tauriEmit('eigendeck:security-changed'); // sidebar re-checks trust/watch
        };
        unlistenReq = await tauriListen<{ action: string }>('eigendeck:security-request', async (e) => {
          try {
            switch (e.payload?.action) {
              case 'trust': {  // "Trust this deck": mint token + createTrustedDeck, persist, reinit
                const { trustThisDeck } = await import('./lib/securityReport');
                await trustThisDeck();
                await saveProject();
                await reinit();
                break;
              }
              case 'watch':    // "Watch files for this deck": clear the per-deck watch-off override
                usePresentationStore.getState().updateConfig({ autoReloadAssets: 'on' });
                await saveProject();
                await reinit();
                break;
              case 'open-settings':  // global watch lives in the app-wide Settings
                void openSettingsWindow();
                break;
            }
          } catch (err) { console.warn('[security-request]', e.payload?.action, err); }
        });
      } catch { /* not in Tauri */ }
    })();
    return () => { if (unlisten) unlisten(); if (unlistenReq) unlistenReq(); };
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
        if (await askConfirm('Promote this animation link to a sync?\n\nThe linked copies become one element (same position and content). This is hard to undo.')) {
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
        case 'paste-as': void openPasteAs(); break;
        case 'install-llm-tools': void installLlmTools(); break;
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
        case 'dump-pasteboard':
          // Debug: dump the OS pasteboard's UTIs + previews to the JS console
          // (and stdout, via the Rust command's println!). Diagnoses which
          // clipboard representations a source app offers for paste routing.
          // DEV-only — the invoke + command are compiled out of release, and
          // import.meta.env.DEV strips this from the production bundle too.
          if (import.meta.env.DEV) {
            import('@tauri-apps/api/core').then(({ invoke }) =>
              invoke<string>('pasteboard_dump')
                .then((r) => console.log('%c[pasteboard_dump]', 'font-weight:bold', '\n' + r))
                .catch((e) => console.error('pasteboard_dump failed', e)));
          }
          break;
        case 'settings':
          void openSettingsWindow();
          break;
        case 'customize-toolbar':  // macOS-standard "Customize Toolbar…" → the
          void openSettingsWindow('ui');   // Settings "UI & Toolbar" section
          break;
        case 'help-learning':
        case 'help-manual':
        case 'help-report-bug': {
          const url = event.payload === 'help-learning' ? 'https://eigendeck.dev/learning'
            : event.payload === 'help-manual' ? 'https://eigendeck.dev/manual'
            : 'https://github.com/dgleich/eigendeck/issues';
          (async () => {
            try {
              const { openUrl } = await import('@tauri-apps/plugin-opener');
              await openUrl(url);
            } catch (e) {
              console.error('Open help URL failed:', e);
            }
          })();
          break;
        }
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
        case 'deck-security': void import('./lib/securityWindow').then((m) => m.openSecurityWindow()); break;
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
  // App-level Settings (⌘,) opens its own window (openSettingsWindow), so it
  // works from the Welcome screen too without mounting anything here (#62).
  if (!projectPath) {
    // Still resolving the launch-file check → render nothing but the toast host,
    // so a file-launch lands straight in the editor instead of flashing the
    // welcome screen for a frame before the deck opens.
    if (!launchChecked) return <ToastHost />;
    return (<><ToastHost /><WelcomeWindow /></>);
  }

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
      const bytes = await withBusy('Reading video…', () => readFileNative(fullPath));
      const mb = bytes.length / (1024 * 1024);
      if (mb > 250) {
        const ok = await confirm(`This video is ${mb.toFixed(0)} MB. It will be embedded in the deck file, making it large. Continue?`, { title: 'Large video', kind: 'warning' });
        if (!ok) return;
      }
      const { storeAssetWithCollisionCheck } = await import('./lib/assetInsert');
      const r = await withBusy('Importing video…', () => storeAssetWithCollisionCheck({ path: relativePath, data: bytes, mimeType: mime, externalPath: relativePath, externalMtime: null }));
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
    <div className={`app${nativeToolbar ? ' native-toolbar' : ''}`}>
      <DebugMenu />
      <ToastHost />
      <BusyOverlay />
      {!nativeToolbar && <Toolbar />}
      <div className="main-area">
        <div style={{ width: sidebarWidth, minWidth: 150, maxWidth: 400, flexShrink: 0 }}>
          <SlideSidebar />
        </div>
        <div className="sidebar-resize-handle" onPointerDown={handleResizeStart} />
        <div className="editor-area" ref={editorAreaRef}>
          <div className="editor-actions" ref={insertHudRef}>
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
          onClose={() => { setContextMenu(null); window.dispatchEvent(new CustomEvent('context-menu-closed')); }} />
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
      {pasteAsReps && (
        <PasteAsModal
          reps={pasteAsReps}
          onCancel={() => setPasteAsReps(null)}
          onPick={(kind) => {
            setPasteAsReps(null);
            window.dispatchEvent(new CustomEvent('eigendeck:paste-as', { detail: { kind } }));
          }}
        />
      )}
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
