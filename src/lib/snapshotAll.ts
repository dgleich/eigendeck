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
import { previewKey, clearPreview, loadPreviewDataUrl, isPreviewThemeStale } from './previewCache';
import { resolveTheme, previewThemeSalt } from './themes';

const isLive = (t: string): boolean =>
  t === 'demo' || t === 'demo-piece' || t === 'video' || t === 'notebook';

/** Per-slide dwell: long enough for a freshly-mounted element's capture effect
 *  (a ~700–900ms debounce) to fire AND its async rasterize to grab the DOM before
 *  we flip away. Generous on purpose — a slow demo/notebook otherwise captures blank. */
const DWELL_MS = 1600;

export interface SnapshotProgress { current: number; total: number }

/** Does this element need a (re)capture? Missing (no current-theme preview — the
 *  export would show a placeholder) OR theme-stale. `force` short-circuits to
 *  always-yes. Content-drift staleness isn't detectable without rendering; those
 *  re-cache on view and via Refresh All. */
async function needsCapture(el: SlideElement, presentation: Presentation, slideIdx: number, force: boolean): Promise<boolean> {
  if (force) return true;
  const key = previewKey(el);
  if (!(await loadPreviewDataUrl(key))) return true; // missing → export placeholder
  const salt = previewThemeSalt(resolveTheme(presentation.theme, presentation.slides[slideIdx].theme));
  return isPreviewThemeStale(key, salt);
}

/**
 * (Re)capture live-element snapshots. Only the slides that actually have a
 * missing/stale element are visited — so a second "Generate Missing" run with
 * nothing missing is a no-op (visits 0 slides, captures 0). `force` (Refresh All)
 * clears every live element's preview first, so all are re-rendered. Restores the
 * original slide + selection. Best-effort. Returns { slidesVisited, captured,
 * totalLive }.
 */
export async function captureAllSnapshots(
  presentation: Presentation,
  opts: { force?: boolean; onProgress?: (p: SnapshotProgress) => void } = {},
): Promise<{ slidesVisited: number; captured: number; totalLive: number }> {
  const force = !!opts.force;
  // All live elements (for totalLive) + which slides have at least one that needs work.
  const liveEls: SlideElement[] = [];
  presentation.slides.forEach((s) => liveEls.push(...s.elements.filter((e) => isLive(e.type))));
  if (!liveEls.length) return { slidesVisited: 0, captured: 0, totalLive: 0 };

  // Refresh All: clear first so every one is "missing" → gets re-rendered.
  if (force) { for (const el of liveEls) await clearPreview(previewKey(el)); }

  const slidesToVisit: number[] = [];
  let captured = 0;
  for (let i = 0; i < presentation.slides.length; i++) {
    let anyNeedy = false;
    for (const el of presentation.slides[i].elements) {
      if (!isLive(el.type)) continue;
      if (await needsCapture(el, presentation, i, force)) { anyNeedy = true; captured++; }
    }
    if (anyNeedy) slidesToVisit.push(i);
  }
  if (!slidesToVisit.length) return { slidesVisited: 0, captured: 0, totalLive: liveEls.length };

  const store = usePresentationStore.getState();
  const originalIdx = store.currentSlideIndex;
  const originalSel = store.selectedObject;
  usePresentationStore.getState().selectObject({ type: 'slide' });
  try {
    for (let n = 0; n < slidesToVisit.length; n++) {
      opts.onProgress?.({ current: n + 1, total: slidesToVisit.length });
      usePresentationStore.getState().selectSlide(slidesToVisit[n]);
      await new Promise((r) => setTimeout(r, DWELL_MS));
    }
  } finally {
    usePresentationStore.getState().selectSlide(originalIdx);
    usePresentationStore.getState().selectObject(originalSel);
  }
  return { slidesVisited: slidesToVisit.length, captured, totalLive: liveEls.length };
}
