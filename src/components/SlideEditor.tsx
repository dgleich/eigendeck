import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { usePresentationStore } from '../store/presentation';
import { usePreference } from '../lib/preferences';
import { gridOverlaySvg } from '../lib/grid';
import { captureHtmlToPng, htmlNeedsScreenshot, extractPastedDataUrlImage } from '../lib/htmlPasteCapture';
import { pasteTextToElementHtml } from '../lib/pasteText';
import { decodeClipHtml } from '../lib/clipboardModel';
import { relPath } from '../App';
import { useDemoDoc, useDeckFontFacesCss, useDemoHost } from '../lib/demoMount';
import { demoVarsCssForSlide } from '../lib/demoThemeInject';
import { SlideElementRenderer } from './SlideElementRenderer';
import { getSlideNumber, createTextElement } from '../types/presentation';
import { showFooter, footerFontFamily } from '../lib/footer.mjs';
import { resolveTheme } from '../lib/themes';
import { detectAssetKind } from '../lib/assetCache';
import { hasFreshInternalAsset } from '../lib/elementClipboard';
import { hasEigendeckMarker } from '../lib/clipboard';
import { handleSvgExternalRefs, invalidateRenderedAsset } from '../lib/assetRenderer';
import type { SlideElement } from '../types/presentation';
import type { MenuEntry } from './ContextMenu';
import { setContextTarget } from '../lib/contextTarget';
import { readTextFileNative } from '../lib/nativeFs';

export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;
/** Extra room (px) reserved below the slide, ON TOP OF the canvas container's
 *  bottom padding, when fitting. 0 = the bottom gap equals the left/right padding
 *  (symmetric margins around the slide). */
const CANVAS_GAP = 0;

// Layout constants moved to PropertiesPanel

export function SlideEditor() {
  const {
    presentation, currentSlideIndex,
    addElement, updateElement, deleteElement,
    selectObject, toggleSelectElement, selectedObject, projectPath,
    showGrid,
  } = usePresentationStore();
  useDemoHost(); // relay + rAF pump for the editor's live demos
  const [gridSpacing] = usePreference('gridSpacing');

  const slide = presentation.slides[currentSlideIndex];
  // Whether the canvas (and its containerRef) actually renders — a 0-slide deck
  // returns null below, so the container is absent. Effects that attach to the
  // container must re-run when this flips (#103: an empty deck left the observer
  // unattached, so the next deck rendered at the default scale = zoomed in).
  const slidePresent = !!slide;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  // Fit the 1920×1080 canvas into the container. The canvas uses transform:
  // scale(), which does NOT change its layout box, so nothing about the layout
  // self-corrects the scale — it's whatever this last computed. Guard ≤0
  // measurements (a not-yet-laid-out container gives (0-padding)/W < 0 → a
  // broken/tiny scale).
  const fitScale = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (el.clientWidth <= 0 || el.clientHeight <= 0) return;
    // Fit into the actual CONTENT box (clientWidth/Height include padding, which is
    // now asymmetric + dynamic — the floating HUD sets a variable top padding), and
    // reserve CANVAS_GAP below so the slide isn't scaled flush to the bottom edge.
    const cs = getComputedStyle(el);
    const availW = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH =
      el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - CANVAS_GAP;
    if (availW <= 0 || availH <= 0) return;
    const next = Math.min(availW / SLIDE_WIDTH, availH / SLIDE_HEIGHT, 1);
    if (next > 0) setScale(next);
  }, []);

  // Live re-fit on container resize (window/panel changes). Re-runs when
  // slidePresent flips so the observer (re)attaches once the container actually
  // mounts — otherwise opening a deck after a 0-slide deck leaves it unattached.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => fitScale());
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitScale, slidePresent]);

  // Re-fit whenever a deck opens. The observer ONLY fires on container SIZE
  // changes, and SlideEditor persists across deck opens (no remount), so the
  // scale captured at the first welcome→editor mount would otherwise stick for
  // EVERY deck this session — wrong in whichever direction that first
  // measurement was off (#103: "tiny slides", and its "zoomed-in" twin). Re-fit
  // now AND after layout settles (scrollbars/panels) so each opened deck gets a
  // correct fit regardless of prior (e.g. blank-open) state.
  useLayoutEffect(() => {
    fitScale();
    const raf = requestAnimationFrame(fitScale);
    return () => cancelAnimationFrame(raf);
  }, [projectPath, slidePresent, fitScale]);

  // Cmd+V image paste
  useEffect(() => {
    const PASTE_LOG = false;
    const plog = (...a: unknown[]): void => {
      if (PASTE_LOG) console.log(`[paste ${new Date().toISOString().slice(11, 23)}]`, ...a);
    };

    const handlePaste = async (e: ClipboardEvent) => {
      // Don't intercept paste if user is editing a text element
      if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return;

      // If a FRESH eigendeck asset is on the internal clip, the App-level paste
      // handler restores it (with attributes, into this deck). Defer so we don't
      // ALSO paste the system-clipboard copy of it — that was the double-paste.
      // (Staleness-checked in Rust, so a foreign image still falls through here.)
      if (await hasFreshInternalAsset()) return;

      const T_PASTE = performance.now();
      plog('paste-handler started');

      // Capture text/html NOW — clipboardData can be neutered after the awaits
      // below. Used for the Google-Sheets table fallback: Sheets puts only
      // text/html + text/plain on the clipboard (no image), so the image
      // paths below all miss and we render the HTML table to SVG instead.
      const htmlEarly = e.clipboardData?.getData('text/html') || '';
      // Same reason: capture text/plain up front for the text-element fallback
      // (#161). clipboardData is neutered by the awaits below, so reading it
      // there would come back empty for a plain-text (Keynote/Pages) paste.
      const plainEarly = e.clipboardData?.getData('text/plain') || '';

      // PRIVATE Eigendeck flavor FIRST (read private-first, per
      // docs/copy-and-paste.md): an internal element/slide/multi copy round-trips
      // with full fidelity straight from the OS clipboard — no separate buffer to
      // desync. Cross-platform: clipboardData carries it on Linux/Windows; on
      // macOS clipboardData is empty for a canvas paste, so also read the native
      // pasteboard's public.html. Wins over images/text below.
      {
        let clip = decodeClipHtml(htmlEarly);
        if (!clip) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            const b = await invoke<number[] | null>('pasteboard_read_type', { uti: 'public.html' });
            if (b && b.length) clip = decodeClipHtml(new TextDecoder('utf-8').decode(new Uint8Array(b)));
          } catch { /* non-macOS / no native pasteboard */ }
        }
        if (clip) {
          e.preventDefault();
          const { pasteInternalClip } = await import('../lib/pasteClip');
          pasteInternalClip(clip);
          plog('pasted internal clip → ' + clip.kind);
          return;
        }
      }

      // Native NSPasteboard path FIRST: WebKit's clipboardData /
      // navigator.clipboard.read() filter out non-standard UTIs (notably
      // com.microsoft.image-svg-xml from Office, com.adobe.pdf from
      // Adobe apps). Going through the Rust pasteboard_* commands gets
      // us the unfiltered list and can read the real bytes.
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const t1 = performance.now();
        const nativeTypes = await invoke<string[]>('pasteboard_list_types');
        plog(`pasteboard_list_types: ${(performance.now() - t1).toFixed(0)}ms (${nativeTypes.length} UTIs)`);
        // Preference: SVG > PDF > raster (mirrors the web-API picker).
        // PDF will move ahead of SVG once pdfium renders.
        const NATIVE_PREFER: Array<{ utis: string[]; ext: string; mime: string }> = [
          { utis: ['public.svg-image', 'com.microsoft.image-svg-xml', 'image/svg+xml'], ext: 'svg', mime: 'image/svg+xml' },
          { utis: ['com.adobe.pdf', 'application/pdf'], ext: 'pdf', mime: 'application/pdf' },
          { utis: ['public.png', 'image/png'], ext: 'png', mime: 'image/png' },
          { utis: ['public.jpeg', 'image/jpeg', 'public.jpg'], ext: 'jpg', mime: 'image/jpeg' },
        ];
        // A TEXT/document copy (Word, Pages, a browser selection) puts a PDF
        // *rendering* of the text on the pasteboard alongside the real rich text
        // — do NOT let that PDF hijack a text paste as an image. When rich text
        // (public.html/public.rtf) is present, skip the PDF preference so the
        // native text read below wins. A genuine graphic/vector copy carries no
        // rich text, so its PDF is still taken. SVG/PNG/TIFF are untouched (real
        // graphics from Office/Illustrator/screenshots). See #161 / pasteboard dump.
        const hasRichText = nativeTypes.includes('public.html') || nativeTypes.includes('public.rtf');
        for (const pref of NATIVE_PREFER) {
          if (pref.ext === 'pdf' && hasRichText) continue;
          for (const uti of pref.utis) {
            if (!nativeTypes.includes(uti)) continue;
            const tRead = performance.now();
            const bytesAsNumArray = await invoke<number[] | null>('pasteboard_read_type', { uti });
            plog(`pasteboard_read_type(${uti}): ${(performance.now() - tRead).toFixed(0)}ms${bytesAsNumArray ? ` → ${bytesAsNumArray.length}B` : ' → null'}`);
            if (!bytesAsNumArray || bytesAsNumArray.length === 0) continue;
            const bytes = new Uint8Array(bytesAsNumArray);
            const fileName = `pasted-${Date.now()}.${pref.ext}`;
            const relativePath = `images/${fileName}`;
            plog(`native picked uti=${uti} → ${pref.mime} (${bytes.length} bytes) → ${fileName}`);
            e.preventDefault();
            const tInsert = performance.now();
            await insertPastedAsset(relativePath, bytes, pref.mime, fileName);
            plog(`insertPastedAsset: ${(performance.now() - tInsert).toFixed(0)}ms · total handler: ${(performance.now() - T_PASTE).toFixed(0)}ms`);
            return;
          }
        }
        // No native IMAGE UTI matched → try native TEXT. On macOS, WebKit does
        // NOT expose text/plain|text/html on clipboardData for a non-editable
        // paste target (the slide canvas), so every clipboard-based text path
        // below is dead there — the paste silently no-ops. Read the real bytes
        // off NSPasteboard instead: prefer public.html (styled / tables) then
        // plain text. #161. (No-op on Linux/Windows — pasteboard_* return empty
        // there, so those platforms fall through to the web clipboard below.)
        const readNativeText = async (uti: string): Promise<string> => {
          if (!nativeTypes.includes(uti)) return '';
          const b = await invoke<number[] | null>('pasteboard_read_type', { uti });
          return b && b.length ? new TextDecoder('utf-8').decode(new Uint8Array(b)) : '';
        };
        const nativeHtml = await readNativeText('public.html');
        const nativePlain = (await readNativeText('public.utf8-plain-text')) || (await readNativeText('public.text'));
        if (nativeHtml || nativePlain) {
          if (await insertRichHtmlScreenshot(nativeHtml)) { e.preventDefault(); return; }
          if (insertPastedText(nativeHtml, nativePlain)) { e.preventDefault(); return; }
        }
        plog('native pasteboard had no preferred UTI; falling through to web clipboard');
      } catch (err) {
        plog('native pasteboard read failed (non-Mac or perm denied?):', err);
      }

      const items = e.clipboardData?.items;
      if (!items) return;

      // Log every MIME the sync DataTransfer API offered so we can diagnose
      // "I pasted an SVG but it came out PNG" — most apps only put the
      // rasterized form on the clipboard; the vector source might exist
      // elsewhere (text/plain XML, system-specific UTI) or not at all.
      const itemList = Array.from(items);
      const syncMimes = itemList.map((it) => `${it.kind}:${it.type}`);
      plog('sync clipboard items:', syncMimes);

      // Each format may appear on the clipboard under several aliases:
      // standard MIME, Apple UTI (public.*), or vendor-specific UTI
      // (com.microsoft.image-svg-xml, com.adobe.pdf). We try them all
      // and normalize to a canonical mime + extension for storage so the
      // saved asset is identifiable regardless of which UTI the source
      // app used.
      //
      // Priority order: SVG > PDF > raster. PDF would be higher fidelity
      // in principle but it can't render until the pdfium path lands, so
      // for now SVG wins when both are present (typical Office pastes).
      // Flip SVG and PDF here once PDF display works.
      type Format = { aliases: readonly string[]; ext: string; canonicalMime: string };
      const PREFERRED_FORMATS: readonly Format[] = [
        { aliases: ['image/svg+xml', 'public.svg-image', 'com.microsoft.image-svg-xml'], ext: 'svg', canonicalMime: 'image/svg+xml' },
        { aliases: ['application/pdf', 'com.adobe.pdf'], ext: 'pdf', canonicalMime: 'application/pdf' },
        { aliases: ['image/png', 'public.png'], ext: 'png', canonicalMime: 'image/png' },
        { aliases: ['image/jpeg', 'public.jpeg', 'public.jpg'], ext: 'jpg', canonicalMime: 'image/jpeg' },
        { aliases: ['image/gif', 'com.compuserve.gif'], ext: 'gif', canonicalMime: 'image/gif' },
        { aliases: ['image/webp', 'org.webmproject.webp'], ext: 'webp', canonicalMime: 'image/webp' },
      ];
      let picked: DataTransferItem | null = null;
      let pickedFormat: Format | null = null;
      let pickedAlias: string | null = null;
      outer: for (const format of PREFERRED_FORMATS) {
        for (const alias of format.aliases) {
          const found = itemList.find((it) => it.type === alias);
          if (found) { picked = found; pickedFormat = format; pickedAlias = alias; break outer; }
        }
      }

      // Fallback: try the async Clipboard API too — on macOS it sometimes
      // exposes formats the sync API doesn't. Only fire if we didn't
      // already find a vector format from the sync API.
      const haveVector = pickedFormat
        && (pickedFormat.canonicalMime === 'application/pdf' || pickedFormat.canonicalMime === 'image/svg+xml');
      if (!haveVector && typeof navigator !== 'undefined' && navigator.clipboard?.read) {
        try {
          const items2 = await navigator.clipboard.read();
          const asyncMimes = items2.flatMap((it) => it.types);
          plog('async clipboard types:', asyncMimes);
          // Walk the PREFERRED_FORMATS in priority order; first vector hit wins.
          for (const format of PREFERRED_FORMATS.filter((f) => f.canonicalMime === 'application/pdf' || f.canonicalMime === 'image/svg+xml')) {
            for (const alias of format.aliases) {
              for (const item of items2) {
                if (item.types.includes(alias)) {
                  const b = await item.getType(alias);
                  const bytes = new Uint8Array(await b.arrayBuffer());
                  const fileName = `pasted-${Date.now()}.${format.ext}`;
                  const relativePath = `images/${fileName}`;
                  plog(`async picked alias=${alias} → ${format.canonicalMime} (${bytes.length} bytes) → ${fileName}`);
                  e.preventDefault();
                  await insertPastedAsset(relativePath, bytes, format.canonicalMime, fileName);
                  return;
                }
              }
            }
          }
        } catch (err) {
          plog('async clipboard read failed:', err);
        }
      }

      // Google Slides (and other apps that embed the image in HTML): copying an
      // image out of Google Slides puts NO image on the clipboard — only text/html
      // like `<b id="docs-internal-guid-…"><img src="data:image/png;base64,…">`.
      // The image-item paths above all miss it, so pull the FIRST data-URL <img>
      // straight out of the HTML and insert the ORIGINAL bytes (not a re-screenshot,
      // which the rich-HTML fallback below would do — lossy + the <b> wrapper's
      // styling). #158.
      if (!picked && !hasEigendeckMarker(htmlEarly)) {
        const embedded = extractPastedDataUrlImage(htmlEarly);
        if (embedded) {
          e.preventDefault();
          const ext = embedded.mime === 'image/jpeg' ? 'jpg' : (embedded.mime.split('/')[1] || 'png');
          const fileName = `pasted-${Date.now()}.${ext}`;
          plog(`extracted data-URL <img> from pasted HTML → ${embedded.mime} (${embedded.bytes.length} bytes) → ${fileName}`);
          await insertPastedAsset(`images/${fileName}`, embedded.bytes, embedded.mime, fileName);
          return;
        }
      }

      // Google Sheets / rich-HTML paste (tables, lists, formatted blocks): no
      // image on the clipboard, but a <table> etc. in text/html. Render it in the
      // deck font and screenshot to a PNG — the browser does the layout (far more
      // robust than parsing one app's markup), and it's a static snapshot so
      // thumbnails/present/export work for free.
      if (!picked && await insertRichHtmlScreenshot(htmlEarly)) { e.preventDefault(); return; }

      // Linux image fallback (#94): WebKitGTK doesn't reliably surface a
      // screenshot's image/png on the sync DataTransfer OR the async Clipboard
      // API, so both image paths above miss. Read the raster straight off the
      // system clipboard via arboard (Rust). Only fires when no web-API image was
      // found and there's no rich HTML to render (Sheets/Slides handled above), so
      // it's a screenshot-shaped last resort. No-op on macOS (returns null).
      if (!picked) {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const png = await invoke<number[] | null>('clip_read_system_image');
          if (png && png.length) {
            e.preventDefault();
            const fileName = `pasted-${Date.now()}.png`;
            plog(`arboard system-image fallback → ${png.length} bytes → ${fileName}`);
            await insertPastedAsset(`images/${fileName}`, new Uint8Array(png), 'image/png', fileName);
            return;
          }
        } catch (err) { plog('clip_read_system_image failed:', err); }
      }

      // Plain / lightly-styled TEXT with no image (#161): text/plain (Keynote/
      // Pages/plain text) or inline-only text/html — block-structured HTML was
      // already handled by the screenshot path above. Create an editable text
      // element that adopts the deck's typography instead of silently no-opping.
      // (macOS reaches this via the native-pasteboard read above, since WebKit
      // leaves clipboardData empty for a non-editable paste there.)
      if (!picked && insertPastedText(htmlEarly, plainEarly)) { e.preventDefault(); return; }

      if (!picked || !pickedFormat) { plog('nothing pasteable in clipboard'); return; }
      e.preventDefault();
      const blob = picked.getAsFile();
      if (!blob) { plog('getAsFile() returned null for alias', pickedAlias); return; }

      const fileName = `pasted-${Date.now()}.${pickedFormat.ext}`;
      const relativePath = `images/${fileName}`;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      plog(`sync picked alias=${pickedAlias} → ${pickedFormat.canonicalMime} (${bytes.length} bytes) → ${fileName}`);
      await insertPastedAsset(relativePath, bytes, pickedFormat.canonicalMime, fileName);
    };

    /** Shared between sync + async paste paths. */
    const insertPastedAsset = async (
      relativePath: string, bytes: Uint8Array, mime: string, fileName: string,
      position?: { x: number; y: number; width: number; height: number },
    ): Promise<void> => {
      let assetId: string;
      try {
        const { storeAssetRaw } = await import('../lib/assetInsert');
        // Paste: no source-on-disk path; pass null for externalPath so the
        // asset isn't watched (clipboard contents have no file to watch).
        const tStore = performance.now();
        // Bytes go through the raw-body IPC (memcpy) — avoids the ~300ms/MB
        // args/JSON path that froze the UI on large assets (#174).
        assetId = await storeAssetRaw({ path: relativePath, mimeType: mime, externalPath: null, externalMtime: null }, bytes);
        plog(`db_store_asset: ${(performance.now() - tStore).toFixed(0)}ms`);
      } catch (e) {
        console.error('Failed to store pasted image:', e);
        return;
      }
      const kind = detectAssetKind(fileName, mime);
      const tAdd = performance.now();
      addElement({
        id: crypto.randomUUID(), type: 'image',
        assetId,
        kind,
        position: position ?? { x: 360, y: 200, width: 1200, height: 680 },
      });
      plog(`addElement: ${(performance.now() - tAdd).toFixed(0)}ms`);
      if (kind === 'svg') {
        // Paste has no source folder — handler will just warn.
        void handleSvgExternalRefs(bytes, fileName, null);
      }
    };

    /** Rich HTML (tables/lists/formatted blocks) → render in the deck font and
     *  screenshot to a PNG, inserted as an image. Shared by the clipboardData
     *  path and the native-pasteboard (macOS) path. Returns true if it inserted. */
    const insertRichHtmlScreenshot = async (html: string): Promise<boolean> => {
      if (!html || !htmlNeedsScreenshot(html) || hasEigendeckMarker(html)) return false;
      const { resolveFontPackage, bareFamilyName } = await import('../lib/fonts');
      const cfg = usePresentationStore.getState().presentation.config;
      const family = bareFamilyName(resolveFontPackage(cfg?.defaultBodyFont));
      const cap = await captureHtmlToPng(html, { fontFamily: `'${family}', sans-serif`, scale: 4 });
      if (!cap) return false;
      // Slide-space box at ~3x the CSS render (capture is 4x → crisp), capped.
      const SCALE = 3;
      let w = cap.width * SCALE, h = cap.height * SCALE;
      const k = Math.min(1, 1600 / w, 900 / h);
      w = Math.round(w * k); h = Math.round(h * k);
      const pos = { x: Math.round((SLIDE_WIDTH - w) / 2), y: Math.round((SLIDE_HEIGHT - h) / 2), width: w, height: h };
      const fileName = `pasted-html-${Date.now()}.png`;
      plog(`pasted HTML → png ${cap.width}x${cap.height} font=${family}`);
      await insertPastedAsset(`images/${fileName}`, cap.bytes, 'image/png', fileName, pos);
      return true;
    };

    /** Plain / lightly-styled text → an editable text element (#161). Shared by
     *  the clipboardData path and the native-pasteboard (macOS) path. Returns
     *  true if it inserted. */
    const insertPastedText = (html: string, plain: string): boolean => {
      if (hasEigendeckMarker(html)) return false;
      const elHtml = pasteTextToElementHtml(html, plain);
      if (!elHtml) return false;
      const W = 900, H = 360;
      const el = createTextElement('textbox', {
        x: Math.round((SLIDE_WIDTH - W) / 2), y: Math.round((SLIDE_HEIGHT - H) / 2), width: W, height: H,
      });
      el.html = elHtml;
      addElement(el);
      selectObject({ type: 'element', id: el.id });
      plog('pasted text → text element');
      return true;
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [projectPath, addElement]);

  // Marquee drag-to-select on canvas background
  const handleCanvasPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return; // only on canvas background
    e.preventDefault();
    selectObject({ type: 'slide' });

    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const startX = (e.clientX - rect.left) / scale;
    const startY = (e.clientY - rect.top) / scale;

    setMarquee({ x1: startX, y1: startY, x2: startX, y2: startY });

    const handleMove = (me: PointerEvent) => {
      const mx = (me.clientX - rect.left) / scale;
      const my = (me.clientY - rect.top) / scale;
      setMarquee({ x1: startX, y1: startY, x2: mx, y2: my });
    };

    const handleUp = (me: PointerEvent) => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);

      const mx = (me.clientX - rect.left) / scale;
      const my = (me.clientY - rect.top) / scale;
      const selX1 = Math.min(startX, mx);
      const selY1 = Math.min(startY, my);
      const selX2 = Math.max(startX, mx);
      const selY2 = Math.max(startY, my);

      // Only select if marquee is larger than a small threshold (avoid accidental clicks)
      if (selX2 - selX1 > 5 || selY2 - selY1 > 5) {
        const currentSlide = usePresentationStore.getState().presentation.slides[
          usePresentationStore.getState().currentSlideIndex
        ];
        const hitIds = currentSlide.elements
          .filter((el: SlideElement) => {
            if (el.type === 'arrow') {
              // Check if either endpoint is inside the marquee
              return (el.x1 >= selX1 && el.x1 <= selX2 && el.y1 >= selY1 && el.y1 <= selY2) ||
                     (el.x2 >= selX1 && el.x2 <= selX2 && el.y2 >= selY1 && el.y2 <= selY2);
            }
            // Box intersection test
            const elX1 = el.position.x;
            const elY1 = el.position.y;
            const elX2 = el.position.x + el.position.width;
            const elY2 = el.position.y + el.position.height;
            return elX1 < selX2 && elX2 > selX1 && elY1 < selY2 && elY2 > selY1;
          })
          .map((el: SlideElement) => el.id);

        if (hitIds.length === 1) {
          selectObject({ type: 'element', id: hitIds[0] });
        } else if (hitIds.length > 1) {
          selectObject({ type: 'multi', ids: hitIds });
        }
      }

      setMarquee(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [scale, selectObject]);

  // Context menu for canvas background. (Per-element right-click is handled in
  // DraggableBox, which stops propagation before this fires.)
  const handleCanvasContextMenu = useCallback((e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const store = usePresentationStore.getState();
    const items: MenuEntry[] = [
      { label: 'Add Title', onClick: () => store.addElement(createTextElement('title')) },
      { label: 'Add Body', onClick: () => store.addElement(createTextElement('body')) },
      { label: 'Add Text Box', onClick: () => store.addElement(createTextElement('textbox')) },
      { label: 'Add Annotation', onClick: () => store.addElement(createTextElement('annotation')) },
      { label: 'Add Footnote', onClick: () => store.addElement(createTextElement('footnote')) },
      { separator: true },
      { label: 'Add Arrow', onClick: () => store.addElement({ id: crypto.randomUUID(), type: 'arrow', x1: 400, y1: 400, x2: 800, y2: 400, position: { x: 0, y: 0, width: 0, height: 0 }, color: '#2563eb', strokeWidth: 4, headSize: 16 }) },
      { separator: true },
      { label: 'Paste', shortcut: '\u2318V', onClick: () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true })) },
      { separator: true },
      { label: 'Slide Properties', onClick: () => {
        store.selectObject({ type: 'slide' });
        if (!store.showProperties) store.toggleProperties();
      }},
    ];
    window.dispatchEvent(new CustomEvent('show-context-menu', { detail: { x: e.clientX, y: e.clientY, items } }));
  }, []);

  // Clear the context-target highlight when any context menu closes.
  useEffect(() => {
    const clear = () => setContextTarget(null);
    window.addEventListener('context-menu-closed', clear);
    return () => window.removeEventListener('context-menu-closed', clear);
  }, []);

  // Drag-and-drop files onto canvas
  const [dragOver, setDragOver] = useState(false);

  // Diagnostic logging — surface in the Debug Console (intercepts console.log)
  // so "drag from PowerPoint did nothing on release" is debuggable.
  const DRAG_LOG = false;  // flip true to trace drag/drop pasteboard handling
  const dlog = (...a: unknown[]): void => {
    if (DRAG_LOG) console.log(`[drag-evt ${new Date().toISOString().slice(11, 23)}]`, ...a);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dlog('dragenter target=', (e.target as Element).tagName,
         'types=', Array.from(e.dataTransfer.types),
         'files=', e.dataTransfer.files.length);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Signal we accept the drop so the OS shows the right cursor.
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    dlog('DROP FIRED target=', (e.target as Element).tagName,
         'types=', Array.from(e.dataTransfer.types),
         'files=', e.dataTransfer.files.length);
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    // FILE drops are delivered by Tauri's OS-level win.onDragDropEvent
    // below; processing them here too would duplicate. Detect by
    // dataTransfer.files: non-empty => Tauri's path will handle it.
    if (e.dataTransfer.files.length > 0) { dlog('skipping in-memory path — Tauri OS event will handle the file drop'); return; }

    // IN-MEMORY drops (e.g. dragging a shape OUT of PowerPoint) DON'T
    // fire Tauri's file event; only the DOM gets them. Same shape as
    // a paste, just from the drag pasteboard instead of the general
    // one — and the webview's DataTransfer is filtered the same way
    // (only image/png + a few standard MIMEs reach JS), so we go to
    // the native NSPasteboard for the drag pasteboard to see vendor
    // UTIs like com.microsoft.image-svg-xml.
    const store = usePresentationStore.getState();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const utis = await invoke<string[]>('pasteboard_list_drag_types');
      dlog('native drag pasteboard UTIs:', utis);
      // Same priority order as paste (SVG > PDF > raster); flip SVG/PDF
      // once pdfium displays PDFs.
      const NATIVE_PREFER: Array<{ utis: string[]; ext: string; mime: string }> = [
        { utis: ['public.svg-image', 'com.microsoft.image-svg-xml', 'image/svg+xml'], ext: 'svg', mime: 'image/svg+xml' },
        { utis: ['com.adobe.pdf', 'application/pdf'], ext: 'pdf', mime: 'application/pdf' },
        { utis: ['public.png', 'image/png'], ext: 'png', mime: 'image/png' },
        { utis: ['public.jpeg', 'image/jpeg', 'public.jpg'], ext: 'jpg', mime: 'image/jpeg' },
      ];
      for (const pref of NATIVE_PREFER) {
        for (const uti of pref.utis) {
          if (!utis.includes(uti)) continue;
          const bytesArr = await invoke<number[] | null>('pasteboard_read_drag_type', { uti });
          if (!bytesArr || bytesArr.length === 0) continue;
          const bytes = new Uint8Array(bytesArr);
          const fileName = `dropped-${Date.now()}.${pref.ext}`;
          const relativePath = `images/${fileName}`;
          const kind = pref.mime === 'image/svg+xml' ? 'svg'
            : pref.mime === 'application/pdf' ? 'pdf' : 'raster';
          dlog(`native picked uti=${uti} → ${pref.mime} (${bytes.length} bytes) → ${fileName}`);
          const assetId = await invoke<string>('db_store_asset', {
            path: relativePath, data: Array.from(bytes), mimeType: pref.mime,
            externalPath: null, externalMtime: null,
          });
          store.addElement({
            id: crypto.randomUUID(), type: 'image', assetId, kind,
            position: { x: 360, y: 200, width: 1200, height: 680 },
          });
          // No unsaved-warning toast: native pasteboard drag stores with
          // externalPath=null (synthetic name like dropped-<ts>.svg),
          // so watching wouldn't apply even after Save. storeAssetWithCollisionCheck
          // fires the warning automatically for paths that DO have an
          // external_path — this branch doesn't go through that helper.
          return;
        }
      }
      dlog('native drag pasteboard had no preferred UTI; falling back to DataTransfer');
    } catch (err) {
      dlog('native drag pasteboard read failed:', err);
    }

    // Web fallback: DataTransfer.items (filtered by WebKit to standard
    // MIMEs). Worth trying for non-Mac and as a safety net.
    const items = Array.from(e.dataTransfer.items);
    dlog('DataTransfer items:', items.map((it) => `${it.kind}:${it.type}`));
    for (const mime of ['image/svg+xml', 'image/png', 'image/jpeg'] as const) {
      const item = items.find((it) => it.type === mime);
      if (!item) continue;
      const blob = item.getAsFile();
      if (!blob) continue;
      const ext = mime === 'image/svg+xml' ? 'svg' : (mime.split('/')[1] || 'png');
      const fileName = `dropped-${Date.now()}.${ext}`;
      const relativePath = `images/${fileName}`;
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const kind = mime === 'image/svg+xml' ? 'svg' : 'raster';
      dlog(`DataTransfer picked ${mime} (${bytes.length} bytes) → ${fileName}`);
      const { invoke } = await import('@tauri-apps/api/core');
      const assetId = await invoke<string>('db_store_asset', {
        path: relativePath, data: Array.from(bytes), mimeType: mime,
        externalPath: null, externalMtime: null,
      });
      store.addElement({
        id: crypto.randomUUID(), type: 'image', assetId, kind,
        position: { x: 360, y: 200, width: 1200, height: 680 },
      });
      // Same as the native-pasteboard branch above: externalPath=null,
      // no watching to warn about.
      return;
    }
  }, []);

  // Tauri drag-drop event (provides file paths directly)
  useEffect(() => {
    // Async-effect cleanup race: if the cleanup runs before the
    // await for onDragDropEvent resolves (StrictMode double-invoke
    // in dev, or fast remount under HMR), the first listener leaks
    // and the next mount registers a SECOND one → every drop fires
    // both handlers → N copies of the asset get added. Track a
    // `cancelled` flag and immediately unsubscribe if we were torn
    // down during the await.
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const win = getCurrentWebviewWindow();
        const u = await win.onDragDropEvent(async (event) => {
          if (event.payload.type === 'drop') {
            const paths: string[] = event.payload.paths;
            const store = usePresentationStore.getState();
            for (const fullPath of paths) {
              const name = fullPath.split('/').pop() || '';
              const isImage = /\.(png|jpg|jpeg|gif|svg|webp|pdf)$/i.test(name);
              const isHtml = /\.html?$/i.test(name);
              const isIpynb = /\.ipynb$/i.test(name);
              const isVideo = /\.(mp4|webm|mov|m4v|ogv|ogg)$/i.test(name);

              if (isImage) {
                try {
                  const { invoke } = await import('@tauri-apps/api/core');
                  const { readAddFileCapped } = await import('../lib/assetInsert');
                  const relativePath = relPath(store.projectPath, fullPath);
                  const bytes = await readAddFileCapped(fullPath);
                  if (!bytes) continue;  // over the size cap → toast shown, skip this file
                  const ext = name.split('.').pop()?.toLowerCase() || 'png';
                  const mime = ext === 'svg' ? 'image/svg+xml'
                    : ext === 'pdf' ? 'application/pdf'
                    : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
                  // Drag-drop: relativePath IS the path-to-source-file from
                  // the .eigendeck dir. Store it as externalPath so the
                  // file-watcher can re-resolve to absolute at runtime and
                  // notice when the source file changes on disk.
                  // Routed through collision helper: hash-differing re-add
                  // prompts the user; same-bytes silently dedups.
                  const { storeAssetWithCollisionCheck } = await import('../lib/assetInsert');
                  const r = await storeAssetWithCollisionCheck({
                    path: relativePath, data: bytes, mimeType: mime,
                    externalPath: relativePath, externalMtime: null,
                  });
                  if (r.cancelled) return;
                  const assetId = r.assetId;
                  const kind = detectAssetKind(name, mime);
                  store.addElement({
                    id: crypto.randomUUID(), type: 'image',
                    assetId,
                    kind,
                    position: { x: 360, y: 200, width: 1200, height: 680 },
                  });
                  // unsaved-warning toast already fired by
                  // storeAssetWithCollisionCheck if it applies.
                  if (kind === 'svg') {
                    // We have the original full path — handler can offer to embed.
                    const updated = await handleSvgExternalRefs(bytes, name, fullPath);
                    if (updated) {
                      // Embed snapshot intentionally SEVERS the source link
                      // (matches the dialog wording — "no longer references
                      // the source files") by clearing external_path. This is
                      // DISTINCT from merely turning off file-watching: that's
                      // the per-asset auto_reload knob, which keeps
                      // external_path so a manual reload still works. Here we
                      // want no source link at all. Same assetId: the embed is
                      // a new version of the same asset, not a new asset.
                      // Direct db_store_asset (skip collision helper): we
                      // KNOW this is a follow-up update to the asset we
                      // just stored, not a real collision.
                      await invoke('db_store_asset', { path: relativePath, data: Array.from(updated), mimeType: mime, externalPath: null, externalMtime: null, assetId });
                      await invalidateRenderedAsset(assetId);
                    }
                  }
                } catch (err) { console.error('Failed to handle dropped image:', err); }
              } else if (isHtml) {
                try {
                  const { readAddFileCapped } = await import('../lib/assetInsert');
                  const relativePath = relPath(store.projectPath, fullPath);
                  const bytes = await readAddFileCapped(fullPath);
                  if (!bytes) continue;  // over the size cap → toast shown, skip this file
                  const html = await readTextFileNative(fullPath);

                  // A dropped .html is ambiguous: an Eigendeck demo (embed as a
                  // demo/demo-piece asset) or a plain HTML snippet the user
                  // wants on the slide. classifyDroppedHtml() is the pure
                  // decision (unit-tested); a non-demo .html falls back to a raw
                  // `html` element (#137) instead of being rejected by the demo
                  // gate.
                  const { classifyDroppedHtml } = await import('../lib/htmlDropRoute');
                  const route = classifyDroppedHtml(html);

                  if (route.kind === 'demo' || route.kind === 'demo-pieces') {
                    // Demo HTML — pass externalPath so the file watcher
                    // can subscribe (auto-reload on disk edits). Same
                    // pattern as image drag-drop above. externalMtime
                    // stays null at insertion; scan-on-load will record
                    // it without invalidating (post-fix watcher checks
                    // hash before invalidating cache).
                    const { storeAssetWithCollisionCheck } = await import('../lib/assetInsert');
                    const r = await storeAssetWithCollisionCheck({
                      path: relativePath, data: bytes, mimeType: 'text/html',
                      externalPath: relativePath, externalMtime: null,
                    });
                    if (r.cancelled) return;
                    const assetId = r.assetId;

                    if (route.kind === 'demo-pieces') {
                      let x = 80;
                      for (const piece of route.pieces) {
                        const width = Math.floor((1760 - (route.pieces.length - 1) * 40) / route.pieces.length);
                        store.addElement({
                          id: crypto.randomUUID(), type: 'demo-piece' as any,
                          piece, assetId,
                          position: { x, y: 200, width, height: 700 },
                        });
                        x += width + 40;
                      }
                    } else {
                      store.addElement({
                        id: crypto.randomUUID(), type: 'demo',
                        assetId,
                        position: { x: 80, y: 200, width: 1760, height: 700 },
                      });
                    }
                  } else if (route.kind === 'html-element') {
                    // Not an Eigendeck demo → insert as a raw HTML element (#137).
                    store.addElement({
                      id: crypto.randomUUID(), type: 'html',
                      position: { x: 560, y: 300, width: 800, height: 500 },
                      html: route.html,
                      ...(route.interactive ? { interactive: true } : {}),
                    });
                  } else {
                    // Not a demo and not a usable snippet (not HTML, scripts,
                    // remote resources) — reject with the reasons, same gate as
                    // the "Insert HTML Element from File" picker.
                    const { showToast } = await import('../lib/toasts');
                    showToast({ kind: 'error', ttl: 9000,
                      message: `That .html isn't a usable HTML element: ${route.problems.join('; ')}` });
                  }
                } catch (err) { console.error('Failed to handle dropped HTML:', err); }
              } else if (isIpynb) {
                try {
                  const { readAddFileCapped } = await import('../lib/assetInsert');
                  const relativePath = relPath(store.projectPath, fullPath);
                  const bytes = await readAddFileCapped(fullPath);
                  if (!bytes) continue;  // over the size cap → toast shown, skip this file
                  // .ipynb is JSON; store as application/x-ipynb+json so
                  // isNotebookFile recognizes the asset on later loads.
                  // externalPath set so the file-watcher reloads the
                  // notebook when the user edits in JupyterLab/VSCode.
                  const { storeAssetWithCollisionCheck } = await import('../lib/assetInsert');
                  const r = await storeAssetWithCollisionCheck({
                    path: relativePath, data: bytes,
                    mimeType: 'application/x-ipynb+json',
                    externalPath: relativePath, externalMtime: null,
                  });
                  if (r.cancelled) return;
                  store.addElement({
                    id: crypto.randomUUID(), type: 'notebook',
                    assetId: r.assetId,
                    position: { x: 80, y: 200, width: 1760, height: 700 },
                  });
                } catch (err) { console.error('Failed to handle dropped notebook:', err); }
              } else if (isVideo) {
                try {
                  const { readAddFileCapped } = await import('../lib/assetInsert');
                  const relativePath = relPath(store.projectPath, fullPath);
                  const bytes = await readAddFileCapped(fullPath);
                  if (!bytes) continue;  // over the size cap → toast shown, skip this file
                  const ext = name.split('.').pop()?.toLowerCase() || 'mp4';
                  const mime = ext === 'webm' ? 'video/webm' : ext === 'mov' ? 'video/quicktime'
                    : ext === 'm4v' ? 'video/x-m4v' : (ext === 'ogv' || ext === 'ogg') ? 'video/ogg' : 'video/mp4';
                  const mb = bytes.length / (1024 * 1024);
                  if (mb > 250) {
                    const { confirm } = await import('@tauri-apps/plugin-dialog');
                    const ok = await confirm(`This video is ${mb.toFixed(0)} MB. It will be embedded in the deck file, making it large. Continue?`, { title: 'Large video', kind: 'warning' });
                    if (!ok) return;
                  }
                  // Embed bytes as an asset; externalPath keeps the source link
                  // for file-watching (same as image/demo drag-drop).
                  const { storeAssetWithCollisionCheck } = await import('../lib/assetInsert');
                  const r = await storeAssetWithCollisionCheck({
                    path: relativePath, data: bytes, mimeType: mime,
                    externalPath: relativePath, externalMtime: null,
                  });
                  if (r.cancelled) return;
                  store.addElement({
                    id: crypto.randomUUID(), type: 'video', kind: 'file',
                    assetId: r.assetId, controls: true,
                    position: { x: 360, y: 200, width: 1200, height: 680 },
                  });
                } catch (err) { console.error('Failed to handle dropped video:', err); }
              }
            }
          }
        });
        // If the effect was cleaned up while we were awaiting the
        // subscribe, immediately undo it.
        if (cancelled) {
          u();
        } else {
          unlisten = u;
        }
      } catch {
        // Not in Tauri — HTML5 drag events will handle it
      }
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  if (!slide) return null;

  const { author, venue } = presentation.config;
  const meta = [author, venue].filter(Boolean).join(' \u00B7 ');

  return (
    <div className="slide-editor">
      {/* Theme now in inspector panel (PropertiesPanel); layout removed in v2 schema */}
      <div className={`slide-canvas-container ${dragOver ? 'drag-over' : ''}`} ref={containerRef}
        onDragEnter={handleDragEnter} onDragOver={handleDragOver}
        onDragLeave={handleDragLeave} onDrop={handleDrop}>
        <div
          ref={canvasRef}
          className="slide-canvas"
          style={{ width: SLIDE_WIDTH, height: SLIDE_HEIGHT, transform: `scale(${scale})`, transformOrigin: 'top center',
            // transform: scale() leaves the layout box at full 1080px, so the
            // unscaled remainder shows as dead space below the slide. Collapse it
            // to the scaled height; the visible gap below comes from fitScale
            // reserving CANVAS_GAP within the content box.
            marginBottom: -(SLIDE_HEIGHT * (1 - scale)),
            // Exposed so in-canvas chrome (badges, lock buttons, notebook
            // controls) can counter-scale to a fixed on-screen size — the
            // canvas transform: scale() otherwise shrinks them with zoom.
            ['--canvas-scale' as string]: String(scale),
            backgroundColor: resolveTheme(presentation.theme, slide.theme).background }}
          onPointerDown={handleCanvasPointerDown}
          onContextMenu={handleCanvasContextMenu}
        >
          {/* Alignment grid dots — editor-only (never in present/export),
              behind elements (zIndex 1), non-interactive. `circle at 0 0`
              puts each dot at the tile's TOP-LEFT corner, so dots land on
              multiples of gridSpacing (0, g, 2g…) — exactly the coordinates
              snapToGrid() rounds to. (Plain `circle` centers the dot in the
              tile, offsetting dots by half a cell from the snap targets.) */}
          {/* The WHOLE overlay — dots, coarse "+" crosses, the every-16 "big
              chunk" cross, AND the dead-center "+" — is ONE inline <svg> covering
              the slide, so everything shares one raster and the center mark can't
              drift off the dot grid on Retina (#89). dangerouslySetInnerHTML is
              safe: the markup is built from numbers + a constant colour. */}
          {showGrid && gridSpacing >= 2 && (
            <div
              data-grid-overlay
              style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
              dangerouslySetInnerHTML={{ __html: gridOverlaySvg(gridSpacing, SLIDE_WIDTH, SLIDE_HEIGHT) }}
            />
          )}
          {slide.elements.map((el, idx) => {
            const isSelected = selectedObject?.type === 'element' && selectedObject.id === el.id
              || selectedObject?.type === 'multi' && selectedObject.ids.includes(el.id);
            const slideTheme = resolveTheme(presentation.theme, slide.theme);
            return (
              <SlideElementRenderer
                key={el.id}
                element={el}
                zIndex={idx + 10}
                scale={scale}
                projectPath={projectPath}
                isSelected={isSelected}
                slideBackground={slideTheme.background}
                theme={slideTheme}
                onUpdate={(changes) => updateElement(el.id, changes)}
                onDelete={() => deleteElement(el.id)}
                onSelect={(e) => {
                  if (e?.shiftKey) toggleSelectElement(el.id);
                  else selectObject({ type: 'element', id: el.id });
                }}
              />
            );
          })}
          {/* Hidden controller iframes for demo-piece elements,
              deduped by assetId. */}
          {(() => {
            const controllers = new Set<string>();
            for (const el of slide.elements) {
              if (el.type !== 'demo-piece') continue;
              controllers.add(el.assetId);
            }
            return Array.from(controllers).map((assetId) => (
              <ControllerIframe key={`controller-${assetId}`} assetId={assetId} />
            ));
          })()}
          {marquee && (() => {
            const x = Math.min(marquee.x1, marquee.x2);
            const y = Math.min(marquee.y1, marquee.y2);
            const w = Math.abs(marquee.x2 - marquee.x1);
            const h = Math.abs(marquee.y2 - marquee.y1);
            return (
              <div className="marquee-selection" style={{
                position: 'absolute', left: x, top: y, width: w, height: h,
                border: '2px dashed #3b82f6', background: 'rgba(59, 130, 246, 0.08)',
                pointerEvents: 'none', zIndex: 9998,
              }} />
            );
          })()}
          {showFooter(slide) && (
            <div className="slide-footer" style={{ fontFamily: footerFontFamily(presentation.config) }}>
              <span className="slide-footer-meta">{meta}</span>
              <span className="slide-footer-number">{getSlideNumber(presentation.slides, currentSlideIndex)}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hidden controller iframe that loads demo HTML from SQLite (opaque origin;
 *  docs/DEMO-PLATFORM.md). Comm with its pieces goes over the parent relay. */
function ControllerIframe({ assetId }: { assetId: string }) {
  const config = usePresentationStore((s) => s.presentation.config);
  const theme = usePresentationStore((s) => s.presentation.theme);
  const slide = usePresentationStore((s) => s.presentation.slides[s.currentSlideIndex]);
  const fontFacesCss = useDeckFontFacesCss();
  const varsCss = slide ? demoVarsCssForSlide(config, theme, slide) : '';
  const src = useDemoDoc(assetId, { hash: 'role=controller', channelKey: assetId, varsCss, fontFacesCss });
  if (!src) return null;
  return (
    <iframe
      src={src}
      sandbox="allow-scripts"
      className="el-demo-frame"
      title={`controller: ${assetId.slice(0, 8)}`}
      style={{ position: 'absolute', width: 0, height: 0, border: 'none', opacity: 0, pointerEvents: 'none' }}
    />
  );
}
