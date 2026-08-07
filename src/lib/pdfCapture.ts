// PDF (Screenshots) export capture pass (#176). Mirrors captureAllSnapshots
// (snapshotAll.ts): step through every slide, let it paint, and screenshot its
// `.slide-canvas` to a JPEG byte array — reporting per-slide progress so the
// caller can drive the same fade/counter busy overlay the Snapshot commands use.
// The actual PDF assembly (buildPdf) + native file write stay with the caller;
// this is just the "walk the deck and grab a picture of each slide" half, split
// out so the progress cadence is unit-testable (jsdom can't rasterize, but the
// onProgress calls + slide restoration are exactly what we want to pin).

import type { Presentation } from '../types/presentation';
import { usePresentationStore } from '../store/presentation';

export interface PdfCaptureProgress { current: number; total: number }

/** Per-slide dwell: long enough for the slide's SVG/demo content to paint before
 *  modern-screenshot reads the DOM (matches the original inline export's 400ms). */
const DWELL_MS = 400;

/**
 * Screenshot every slide to a JPEG byte array (one per slide, in order). Adds
 * `body.pdf-capturing` for the duration (hides editor chrome — resize handles,
 * the cut-off badge, etc.), restores the original slide + selection when done
 * (even on error), and fires `onProgress({current,total})` before each slide so
 * the caller can update the busy counter. A slide whose canvas can't be captured
 * yields an empty byte array (the caller renders a blank page) rather than
 * aborting the whole export. Best-effort; never throws for a single bad slide.
 */
export async function captureSlideJpegs(
  presentation: Presentation,
  opts: {
    onProgress?: (p: PdfCaptureProgress) => void;
    dwellMs?: number;
    width?: number;
    height?: number;
  } = {},
): Promise<Uint8Array[]> {
  const { onProgress, dwellMs = DWELL_MS, width: W = 1920, height: H = 1080 } = opts;
  const { domToDataUrl } = await import('modern-screenshot');
  const store = usePresentationStore.getState();
  const originalIdx = store.currentSlideIndex;
  const originalSel = store.selectedObject;

  usePresentationStore.getState().selectObject({ type: 'slide' });
  document.body.classList.add('pdf-capturing');

  const jpegImages: Uint8Array[] = [];
  const total = presentation.slides.length;
  try {
    for (let i = 0; i < total; i++) {
      onProgress?.({ current: i + 1, total });
      usePresentationStore.getState().selectSlide(i);
      await new Promise((r) => setTimeout(r, dwellMs));

      const canvas = document.querySelector('.slide-canvas') as HTMLElement | null;
      let bytes = new Uint8Array(0);
      if (canvas) {
        try {
          const dataUrl = await domToDataUrl(canvas, {
            width: W, height: H, scale: 1,
            style: { transform: 'none', transformOrigin: 'top left' },
          });
          // Flatten onto an opaque white background and re-encode as JPEG (the PDF
          // embeds JPEG frames; the source PNG may be transparent).
          const img = new Image();
          await new Promise<void>((resolve) => { img.onload = () => resolve(); img.onerror = () => resolve(); img.src = dataUrl; });
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
  } finally {
    document.body.classList.remove('pdf-capturing');
    usePresentationStore.getState().selectSlide(originalIdx);
    usePresentationStore.getState().selectObject(originalSel);
  }
  return jpegImages;
}
