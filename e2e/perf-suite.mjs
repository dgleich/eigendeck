// Structured performance benchmark for ONE deck. Runs a fixed set of named
// activities, repeats the whole session PERF_REPS times (fresh app open each), and
// emits per-activity statistics (median / mean / stdev / min / max + raw reps).
//
// Numbers are ENV-RELATIVE (headless WebKitGTK + software GL in xvfb, not a Mac) —
// the point is a stable, repeatable baseline to diff over time / across builds, NOT
// absolute ms. Driven through the window.__eigendeck seam; per-op timing is in-page
// (performance.now + double-rAF for the paint) so WebDriver IPC isn't in the numbers.
//
// Env: E2E_APP, E2E_DECK (required); PERF_REPS (default 3); PERF_OUT (file to write
// the JSON to; also printed after a PERF_SUITE_JSON marker on stdout).
import { openApp, waitSeam, exec, quit, sleep } from './_ui.mjs';
import { writeFileSync } from 'node:fs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const REPS = parseInt(process.env.PERF_REPS || '3', 10);
const OUT = process.env.PERF_OUT || '';

// A 1x1 PNG data URL for addImage.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

// The in-page activity script: measures each activity and returns { name: msPerOp }.
// Each op is followed by a double-rAF so the number includes the paint. Loop ops
// report the MEDIAN of the individual op times (robust to one-off jank).
const ACTIVITIES = `return (async () => {
  const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  const st = window.__eigendeck.store, s = () => st.getState();
  const nS = () => s().presentation.slides.length;
  const med = (a) => { if (!a.length) return null; const b=[...a].sort((x,y)=>x-y); return Math.round(b[Math.floor(b.length/2)]*10)/10; };
  const timeEach = async (n, fn) => { const ts=[]; for(let i=0;i<n;i++){ const t=performance.now(); await fn(i); await raf(); ts.push(performance.now()-t); } return med(ts); };
  const out = {};
  const N = nS();
  // Cap loop counts so the in-page script stays well under the WebDriver exec
  // timeout on big decks (a 44-slide deck × N*2 switches overran it → null results).
  const NAV = Math.min(24, Math.max(8, N*2));

  // --- editor navigation ---
  s().selectSlide(0); await raf();
  // rapid slide navigation: cycle forward through the deck, per-switch median.
  out.rapidSlideNav = await timeEach(NAV, (i)=>{ s().selectSlide(i % N); });

  // --- editing ops ---
  try { out.addText = await timeEach(10, (i)=>{ s().addElement({id:'psT'+Date.now()+i,type:'text',preset:'body',html:'perf',position:{x:100,y:100,width:300,height:100}}); }); } catch(e){ out.addText=null; }
  try { out.addImage = await timeEach(10, (i)=>{ s().addElement({id:'psI'+Date.now()+i,type:'image',src:'${PNG}',position:{x:150,y:150,width:200,height:200}}); }); } catch(e){ out.addImage=null; }
  try { const ids=s().presentation.slides[s().currentSlideIndex].elements.map(e=>e.id).slice(0,10); out.moveElements = ids.length? await timeEach(10, ()=>{ s().moveElementsBy(ids,5,5); }) : null; } catch(e){ out.moveElements=null; }
  try { out.addSlide = await timeEach(5, ()=>{ s().addSlide(); }); } catch(e){ out.addSlide=null; }
  try { out.undoRedo = st.temporal ? await timeEach(10, async ()=>{ st.temporal.getState().undo(); await raf(); st.temporal.getState().redo(); }) : null; } catch(e){ out.undoRedo=null; }

  // --- present mode ---
  s().selectSlide(0); await raf();
  try {
    let t=performance.now(); s().setPresenting(true);
    for(let i=0;i<60 && !document.querySelector('.present-slide');i++) await raf();
    out.enterPresent = Math.round((performance.now()-t)*10)/10;
    await raf();
    // presentAdvance: repeatedly "next slide" (ArrowRight, present's window listener).
    // Only count advances that actually change the slide; reset to 0 at the end.
    const adv = [];
    for(let i=0;i<NAV;i++){
      const before=s().currentSlideIndex; const t2=performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
      await raf();
      if(s().currentSlideIndex!==before) adv.push(performance.now()-t2);
      else { s().selectSlide(0); await raf(); }
    }
    out.presentAdvance = med(adv);
    // presentPrev: go back through the deck.
    const bak = [];
    for(let i=0;i<NAV;i++){
      const before=s().currentSlideIndex; const t3=performance.now();
      window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));
      await raf();
      if(s().currentSlideIndex!==before) bak.push(performance.now()-t3);
      else { s().selectSlide(N-1); await raf(); }
    }
    out.presentPrev = med(bak);
    t=performance.now(); s().setPresenting(false);
    for(let i=0;i<60 && document.querySelector('.present-slide');i++) await raf();
    out.exitPresent = Math.round((performance.now()-t)*10)/10;
  } catch(e){ out.enterPresent=out.presentAdvance=out.presentPrev=out.exitPresent=null; }

  return out;
})()`;

async function oneRep() {
  const t0 = Date.now();
  const sid = await openApp(APP, DECK);
  if (!sid) return null;
  if (!await waitSeam(sid)) { await quit(sid); return null; }
  const openToSeam = Date.now() - t0;

  // seam → first slide canvas painted
  const tR = Date.now(); let seamToFirstRender = null;
  for (let i=0;i<80;i++){ if (await exec(sid, "return !!document.querySelector('.slide-canvas')")) { seamToFirstRender = Date.now()-tR; break; } await sleep(100); }

  // all sidebar thumbnails rendered
  const nSlides = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
  const tT = Date.now(); let thumbnailsBuild = null;
  for (let i=0;i<150;i++){
    const ready = await exec(sid, `const c=[...document.querySelectorAll('.slide-thumb-clip')]; if(c.length<${nSlides})return false; return c.every(x=>{const im=[...x.querySelectorAll('img')]; return im.length? im.every(y=>y.complete&&y.naturalWidth>0) : !!x.querySelector('.slide-thumb-render')});`);
    if (ready) { thumbnailsBuild = Date.now()-tT; break; } await sleep(100);
  }

  const ops = await exec(sid, ACTIVITIES);
  await quit(sid);
  return { openToSeam, seamToFirstRender, thumbnailsBuild, slides: nSlides, ...(ops || {}) };
}

// ---- run REPS sessions, aggregate ----
const reps = [];
for (let r = 0; r < REPS; r++) {
  const m = await oneRep();
  if (m) { reps.push(m); console.error(`  rep ${r+1}/${REPS}: openToSeam=${m.openToSeam} rapidNav=${m.rapidSlideNav} presentAdvance=${m.presentAdvance}`); }
  else console.error(`  rep ${r+1}/${REPS}: FAILED to open`);
}
if (!reps.length) { console.error('PERF_SUITE_FAIL: no successful reps'); process.exit(1); }

const ACT_KEYS = ['openToSeam','seamToFirstRender','thumbnailsBuild','rapidSlideNav','addText','addImage','moveElements','addSlide','undoRedo','enterPresent','presentAdvance','presentPrev','exitPresent'];
const stat = (vals) => {
  const a = vals.filter(v => typeof v === 'number');
  if (!a.length) return null;
  const s = [...a].sort((x,y)=>x-y);
  const mean = a.reduce((p,c)=>p+c,0)/a.length;
  const sd = Math.sqrt(a.reduce((p,c)=>p+(c-mean)**2,0)/a.length);
  const r2 = (x)=>Math.round(x*10)/10;
  return { median: r2(s[Math.floor(s.length/2)]), mean: r2(mean), stdev: r2(sd), min: r2(s[0]), max: r2(s[s.length-1]), reps: a };
};
const activities = {};
for (const k of ACT_KEYS) { const st = stat(reps.map(r => r[k])); if (st) activities[k] = st; }

const deckName = (DECK.split('/').pop() || DECK).replace(/\.eigendeck$/, '');
const result = { deck: deckName, deckPath: DECK, reps: reps.length, slides: reps[0]?.slides ?? null, activities };
const json = JSON.stringify(result, null, 2);
if (OUT) { writeFileSync(OUT, json); console.error(`  wrote ${OUT}`); }
console.log('PERF_SUITE_JSON');
console.log(json);
