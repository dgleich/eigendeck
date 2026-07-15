// Perf regression probe (#115, #153 guard). Measures the render/preview pipeline
// on a FIXED deck so timings are comparable run-to-run: app-open→seam, seam→first
// slide rendered, all sidebar thumbnails rendered, and a full slide-nav loop
// (responsiveness). Reports median-of-N so headless xvfb noise averages out.
// Absolute numbers are env-relative (slow xvfb, not a Mac) — the point is the
// BEFORE/AFTER delta on the same machine. Prints JSON; never asserts (diagnostic).
//
// Env: E2E_APP, E2E_DECK (a content-rich deck, e.g. examples/graph-explorer.eigendeck),
//      PERF_RUNS (default 3).
import { openApp, waitSeam, exec, quit, sleep } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const RUNS = parseInt(process.env.PERF_RUNS || '3', 10);
const fail = (m) => { console.error('PERF_FAIL:', m); process.exit(1); };
const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

// One measured session: open the deck, time the pipeline, return the marks.
async function once() {
  const t0 = Date.now();
  const sid = await openApp(APP, DECK);
  if (!sid) return null;
  if (!await waitSeam(sid)) { await quit(sid); return null; }
  const openToSeam = Date.now() - t0;

  // seam → first slide canvas painted
  const tSlide = Date.now();
  let firstRender = null;
  for (let i = 0; i < 60; i++) {
    if (await exec(sid, "return !!document.querySelector('.editor-area .slide-canvas, .slide-canvas')")) { firstRender = Date.now() - tSlide; break; }
    await sleep(100);
  }

  // → all sidebar thumbnails rendered (one .slide-thumb-clip per slide, each
  //   with painted content: an <img> with naturalWidth>0 or rendered SVG/text).
  const nSlides = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
  const tThumb = Date.now();
  let thumbs = null;
  for (let i = 0; i < 120; i++) {
    const ready = await exec(sid, `
      const clips=[...document.querySelectorAll('.slide-thumb-clip')];
      if(clips.length < ${nSlides}) return false;
      return clips.every(c=>{
        const imgs=[...c.querySelectorAll('img')];
        if(imgs.length) return imgs.every(im=>im.complete && im.naturalWidth>0);
        return !!c.querySelector('.slide-thumb-render');  // no-image slide: the render div is enough
      });`);
    if (ready) { thumbs = Date.now() - tThumb; break; }
    await sleep(100);
  }

  // Common editing operations, timed IN-PAGE (performance.now + double-rAF for the
  // paint) so each number is the real perceived cost of one op, not WebDriver IPC.
  const ops = await exec(sid, `return (async () => {
    const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const st = window.__eigendeck.store, s = () => st.getState();
    const time = async (n, fn) => { const t = performance.now(); for (let i = 0; i < n; i++) await fn(i); return Math.round((performance.now() - t) / n); };
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const out = {};
    const nS = () => s().presentation.slides.length;
    out.switchSlide_ms = await time(Math.max(4, nS()), (i) => { s().selectSlide(i % nS()); return raf(); });
    out.addText_ms  = await time(10, (i) => { s().addElement({ id: 'pfT' + Date.now() + i, type: 'text', preset: 'body', html: 'perf', position: { x: 100, y: 100, width: 300, height: 100 } }); return raf(); });
    out.addImage_ms = await time(10, (i) => { s().addElement({ id: 'pfI' + Date.now() + i, type: 'image', src: png, position: { x: 150, y: 150, width: 200, height: 200 } }); return raf(); });
    out.addSlide_ms = await time(5, () => { s().addSlide(); return raf(); });
    const ids = s().presentation.slides[s().currentSlideIndex].elements.map(e => e.id).slice(0, 10);
    if (ids.length) out.moveElements_ms = await time(10, () => { s().moveElementsBy(ids, 5, 5); return raf(); });
    if (st.temporal) out.undoRedo_ms = await time(10, async () => { st.temporal.getState().undo(); await raf(); st.temporal.getState().redo(); return raf(); });
    return out;
  })()`);

  await quit(sid);
  return { openToSeam, firstRender, thumbs, nSlides, ...(ops || {}) };
}

const runs = [];
for (let i = 0; i < RUNS; i++) {
  const r = await once();
  if (r) { runs.push(r); console.log(`  run ${i + 1}: ${JSON.stringify(r)}`); }
  else console.log(`  run ${i + 1}: FAILED (open/seam)`);
  await sleep(500);
}
if (!runs.length) fail('all runs failed to open');

const M = (k) => med(runs.map((r) => r[k]).filter((x) => x != null));
const report = {
  deck: (DECK || '').split('/').pop(),
  runs: runs.length,
  slides: runs[0].nSlides,
  // pipeline (open / preview)
  openToSeam_ms: M('openToSeam'),
  seamToFirstSlide_ms: M('firstRender'),
  allThumbnails_ms: M('thumbs'),
  // common editing operations (per-op)
  switchSlide_ms: M('switchSlide_ms'),
  addText_ms: M('addText_ms'),
  addImage_ms: M('addImage_ms'),
  addSlide_ms: M('addSlide_ms'),
  moveElements_ms: M('moveElements_ms'),
  undoRedo_ms: M('undoRedo_ms'),
};
console.log('PERF_REPORT ' + JSON.stringify(report, null, 2));
process.exit(0);
