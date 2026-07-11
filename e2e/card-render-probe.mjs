// Card (#132) render smoke across the REAL app's render paths, on a light theme
// (white → pastel tint branch) and a dark theme (dark → lift branch). The Card is
// a themed FILL (boxTint + borderRadius + boxShadow) on the ordinary text element,
// wired by hand into every path — the classic 7-path straggler trap. The unit test
// (src/lib/cardRenderPaths.test.tsx) pins the emitted markup; THIS proves the real
// WebKitGTK webview resolves the tint on-screen and the real invoke-backed export
// pipeline carries it. Asserts, per theme:
//   - editor canvas (#1)        — computed background == resolved tint
//   - sidebar thumbnail (#7)    — a thumb div computes the resolved tint
//   - present / projector (#2)  — computed background == resolved tint
//   - HTML export (#4, GUI)     — real exportHtml() contains the tint hex
// Also drops PNGs of the editor + present card into PROBE_OUT for eyeballing.
// (PDF/print #5 is dialog-gated headlessly; it shares textElementHtml with #4 and
// is covered by the unit test.)
import { writeFileSync, mkdirSync } from 'node:fs';
import { textBackgroundResolved } from '../src/lib/textStyle.mjs';
import { themeColorsByName } from '../src/lib/themeColors.mjs';

const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/card-e2e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('CARD_FAIL:', m); process.exit(1); };

/** '#rrggbb' → 'rgb(r, g, b)' as WebKit's getComputedStyle serializes it. */
function hexToRgb(hex) { const h = hex.replace('#', ''); return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`; }

// Expected tints, computed from the SAME source of truth the app uses.
const CARD = { boxTint: 'accent' };
const SLIDES = [
  { i: 0, name: 'white', elId: 'cardW' },
  { i: 1, name: 'dark', elId: 'cardD' },
].map((s) => {
  const hex = textBackgroundResolved(CARD, themeColorsByName('white', s.name));
  return { ...s, hex, rgb: hexToRgb(hex) };
});

function savePng(dataUrl, file) {
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,')) return false;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${file}`, Buffer.from(dataUrl.split(',')[1], 'base64'));
  return true;
}

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

for (const s of SLIDES) {
  // ---- editor canvas (#1) ---- (not presenting here, and sidebar thumbs carry
  // no .el-text, so the tinted .el-text is unambiguously the editor card)
  await exec(sid, `window.__eigendeck.store.getState().selectSlide(${s.i});`);
  for (let i = 0; i < 15; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.el-text foreignObject')")) break; }
  const ed = await exec(sid, `
    const want = ${JSON.stringify(s.rgb)};
    const wrap = [...document.querySelectorAll('.el-text')].find(w => getComputedStyle(w).backgroundColor === want);
    if (!wrap) return { err: 'no editor .el-text computes tint ${s.rgb}', bgs: [...document.querySelectorAll('.el-text')].map(w => getComputedStyle(w).backgroundColor) };
    const cs = getComputedStyle(wrap);
    return { radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
  `);
  if (!ed || ed.err) problems.push(`[${s.name}] editor: ${ed?.err || 'no result'} (saw ${JSON.stringify(ed?.bgs)})`);
  else {
    if (!/30px/.test(ed.radius)) problems.push(`[${s.name}] editor radius ${ed.radius} != 30px`);
    if (!ed.shadow || ed.shadow === 'none') problems.push(`[${s.name}] editor has no box-shadow`);
  }
  savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.slide-canvas').then(u=>d(u)).catch(()=>d(null));`), `editor-${s.name}.png`);

  // ---- sidebar thumbnail (#7) ---- match a thumb div computing the tint
  const thumbBg = await exec(sid, `
    const th = document.querySelectorAll('.slide-thumbnail')[${s.i}];
    if (!th) return { err: 'no thumbnail[${s.i}]' };
    const want = ${JSON.stringify(s.rgb)};
    const hit = [...th.querySelectorAll('.slide-thumb-render div')].some(d => getComputedStyle(d).backgroundColor === want);
    return { hit };
  `);
  if (!thumbBg || thumbBg.err) problems.push(`[${s.name}] thumbnail: ${thumbBg?.err || 'no result'}`);
  else if (!thumbBg.hit) problems.push(`[${s.name}] thumbnail: no div computes tint ${s.rgb}`);

  // ---- present / projector (#2) ----
  await exec(sid, `window.__eigendeck.store.getState().setPresenting(true); window.__eigendeck.store.getState().selectSlide(${s.i});`);
  for (let i = 0; i < 15; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-slide .el-text foreignObject')")) break; }
  const pr = await exec(sid, `
    const want = ${JSON.stringify(s.rgb)};
    const wrap = [...document.querySelectorAll('.present-slide .el-text')].find(w => getComputedStyle(w).backgroundColor === want);
    if (!wrap) return { bgs: [...document.querySelectorAll('.present-slide .el-text')].map(w => getComputedStyle(w).backgroundColor) };
    const cs = getComputedStyle(wrap);
    return { ok: true, radius: cs.borderTopLeftRadius, shadow: cs.boxShadow };
  `);
  if (!pr || !pr.ok) problems.push(`[${s.name}] present: no .el-text computes tint ${s.rgb} (saw ${JSON.stringify(pr?.bgs)})`);
  else {
    if (!/30px/.test(pr.radius)) problems.push(`[${s.name}] present radius ${pr.radius} != 30px`);
    if (!pr.shadow || pr.shadow === 'none') problems.push(`[${s.name}] present has no box-shadow`);
  }
  savePng(await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.present-slide').then(u=>d(u)).catch(()=>d(null));`), `present-${s.name}.png`);
  await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
}

// ---- HTML export (#4, real GUI pipeline) ----
const html = await execA(sid, `const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.exportHtml()).then(h=>d(h)).catch(e=>d('ERR:'+e));`);
if (typeof html !== 'string' || html.startsWith('ERR:')) problems.push(`export: ${html}`);
else for (const s of SLIDES) if (!html.includes(`background:${s.hex}`)) problems.push(`[${s.name}] export HTML missing background:${s.hex}`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});

if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} render-path problem(s)`); }
console.log(`CARD_PASS: tint+radius+shadow render in editor/thumbnail/present/export for ${SLIDES.map(s => `${s.name}(${s.hex})`).join(', ')}; PNGs → ${OUT}/`);
process.exit(0);
