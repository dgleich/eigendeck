// "Generate Missing Snapshots" / "Refresh All Snapshots" (#109-adjacent).
//
// Live elements (demo / demo-piece / video / notebook) render to a static
// snapshot only when their slide is mounted — so a deck you open and export
// without visiting every slide has holes (placeholders in print/export/
// thumbnails). This walks the deck, visiting each slide with a live element so
// that element's OWN capture effect (SlideElementRenderer / NotebookContent —
// which already knows the right per-type args: 'iframe'/'.nb-frame'/'video', the
// theme salt, the background) fires and persists. We don't re-implement per-type
// capture; we just make sure every element gets a turn on screen.
//
//   - Generate Missing: capturePreview's own skip means only missing/stale ones
//     actually re-render; current ones are no-ops.
//   - Refresh All (force): clear each live element's cached preview first, so the
//     visit re-renders everything.

import type { Presentation, SlideElement } from '../types/presentation';
import { usePresentationStore } from '../store/presentation';
import { previewKey, clearPreview } from './previewCache';

const isLive = (t: string): boolean =>
  t === 'demo' || t === 'demo-piece' || t === 'video' || t === 'notebook';

/** Per-slide dwell: long enough for a freshly-mounted element's capture effect
 *  (a ~700–900ms debounce) to fire AND its async rasterize to grab the DOM before
 *  we flip away. Generous on purpose — a slow demo/notebook otherwise captures blank. */
const DWELL_MS = 1600;

export interface SnapshotProgress { current: number; total: number }

/**
 * Visit every slide that has a live element so its snapshot is (re)captured.
 * `force` clears each live element's cached preview first (full re-render).
 * Restores the original slide + selection when done. Best-effort: an element that
 * fails to capture just stays missing (no worse than before). Returns counts.
 */
export async function captureAllSnapshots(
  presentation: Presentation,
  opts: { force?: boolean; onProgress?: (p: SnapshotProgress) => void } = {},
): Promise<{ slidesVisited: number; liveElements: number }> {
  const slideIdxs: number[] = [];
  const liveEls: SlideElement[] = [];
  presentation.slides.forEach((s, i) => {
    const els = s.elements.filter((e) => isLive(e.type));
    if (els.length) { slideIdxs.push(i); liveEls.push(...els); }
  });
  if (!slideIdxs.length) return { slidesVisited: 0, liveElements: 0 };

  if (opts.force) {
    for (const el of liveEls) await clearPreview(previewKey(el));
  }

  const store = usePresentationStore.getState();
  const originalIdx = store.currentSlideIndex;
  const originalSel = store.selectedObject;
  usePresentationStore.getState().selectObject({ type: 'slide' });
  try {
    for (let n = 0; n < slideIdxs.length; n++) {
      opts.onProgress?.({ current: n + 1, total: slideIdxs.length });
      usePresentationStore.getState().selectSlide(slideIdxs[n]);
      await new Promise((r) => setTimeout(r, DWELL_MS));
    }
  } finally {
    usePresentationStore.getState().selectSlide(originalIdx);
    usePresentationStore.getState().selectObject(originalSel);
  }
  return { slidesVisited: slideIdxs.length, liveElements: liveEls.length };
}
