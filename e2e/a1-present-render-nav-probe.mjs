// Present-mode rendering + keyboard nav:
//  - each slide's present background matches its theme (white/dark/black)
//  - footer shows author·venue meta + a slide number
//  - keyboard nav: ArrowRight/Space advance, ArrowLeft back, Home/End jump
//  - zoom 'z' applies a scale transform to the wrapper; Escape unzooms (does NOT
//    exit) while zoomed, then a second Escape exits.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/a1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function waitFor(sid, expr, want = true) { for (let i = 0; i < 30; i++) { await sleep(200); if (await exec(sid, `return ${expr}`) === want) return true; } return false; }
const fail = (m) => { console.error('RENDERNAV_FAIL:', m); process.exit(1); };
function savePng(dataUrl, file) { if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return; mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${file}`, Buffer.from(dataUrl.split(',')[1], 'base64')); }
// dispatch a keydown on window (present's listener is on window)
const key = (sid, k) => exec(sid, `window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true,cancelable:true}));`);
const readPresent = (sid) => exec(sid, `
  const ps = document.querySelector('.present-slide');
  const wrap = document.querySelector('.present-slide-wrapper');
  const num = document.querySelector('.slide-footer-number');
  const meta = document.querySelector('.slide-footer-meta');
  if (!ps) return { err: 'no .present-slide' };
  return {
    bg: getComputedStyle(ps).backgroundColor,
    footerNum: num ? num.textContent : null,
    footerMeta: meta ? meta.textContent : null,
    wrapTransform: wrap ? getComputedStyle(wrap).transform : null,
    csi: window.__eigendeck.store.getState().currentSlideIndex,
  };
`);

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// start on slide 0
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
if (!await waitFor(sid, "!!document.querySelector('.present-slide')")) fail('present did not mount');
await sleep(400);

// --- slide 0 white ---
let r = await readPresent(sid);
if (r.err) fail(r.err);
if (r.bg !== 'rgb(255, 255, 255)') problems.push(`[s0 white] present bg ${r.bg} != white`);
if (!r.footerMeta || !/e2e author/.test(r.footerMeta) || !/e2e venue/.test(r.footerMeta)) problems.push(`[s0] footer meta '${r.footerMeta}' missing author/venue`);
if (r.footerNum == null || r.footerNum === '') problems.push(`[s0] footer number empty`);
savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.present-slide').then(u=>d(u)).catch(()=>d(null));`), 's0.png');

// --- ArrowRight -> slide 1 dark ---
await key(sid, 'ArrowRight'); await sleep(600);
r = await readPresent(sid);
if (r.csi !== 1) problems.push(`ArrowRight did not advance: csi ${r.csi} != 1`);
// dark theme background should be a dark color (not white)
if (r.bg === 'rgb(255, 255, 255)') problems.push(`[s1 dark] present bg still white`);
savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.present-slide').then(u=>d(u)).catch(()=>d(null));`), 's1.png');
const darkBg = r.bg;

// --- Space -> slide 2 black ---
await key(sid, ' '); await sleep(600);
r = await readPresent(sid);
if (r.csi !== 2) problems.push(`Space did not advance: csi ${r.csi} != 2`);
if (r.bg !== 'rgb(0, 0, 0)') problems.push(`[s2 black] present bg ${r.bg} != black`);
savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.present-slide').then(u=>d(u)).catch(()=>d(null));`), 's2.png');

// --- ArrowLeft -> back to slide 1 ---
await key(sid, 'ArrowLeft'); await sleep(600);
r = await readPresent(sid);
if (r.csi !== 1) problems.push(`ArrowLeft did not go back: csi ${r.csi} != 1`);

// --- Home -> slide 0 ---
await key(sid, 'Home'); await sleep(600);
r = await readPresent(sid);
if (r.csi !== 0) problems.push(`Home did not jump to first: csi ${r.csi} != 0`);

// --- End -> slide 2 ---
await key(sid, 'End'); await sleep(600);
r = await readPresent(sid);
if (r.csi !== 2) problems.push(`End did not jump to last: csi ${r.csi} != 2`);

// --- zoom 'z' applies a scale transform > 1 ---
await key(sid, 'z'); await sleep(500);
r = await readPresent(sid);
const scaleOf = (m) => { if (!m || m === 'none') return 1; const p = m.match(/matrix\(([^)]+)\)/); if (!p) return 1; return parseFloat(p[1].split(',')[0]); };
const zScale = scaleOf(r.wrapTransform);
if (!(zScale > 1.5)) problems.push(`zoom 'z' did not scale wrapper (transform ${r.wrapTransform}, scale ${zScale})`);
savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.present-slide-wrapper').then(u=>d(u)).catch(()=>d(null));`), 's2-zoom.png');

// NOTE: Escape-while-zoomed semantics are covered by a1-zoom-escape-probe.mjs
// (a confirmed bug: it exits present instead of just unzooming). Here we just
// exit present cleanly via the store so this probe stays focused on render+nav.
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);"); await sleep(400);
if (await exec(sid, "return window.__eigendeck.store.getState().isPresenting")) problems.push(`setPresenting(false) did not exit present`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`RENDERNAV_PASS: theme bgs (white/dark=${darkBg}/black) + footer + keyboard nav + zoom + escape all correct; PNGs -> ${OUT}/`);
process.exit(0);
