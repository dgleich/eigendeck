// #129 curved arrows in the REAL app: verifies (1) a fixture curved arrow renders
// as an SVG <path> in the editor, (2) the inspector Shape=Curved toggle materializes
// control points on the straight arrow, (3) HTML export emits <path> for the curve,
// and (4) present mode renders a <path>. Screenshots the editor + present for eyeball.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/arrow-spline-e2e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('SPLINE_FAIL:', m); process.exit(1); };
async function shot(sid, sel, name) {
  const u = await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement(${JSON.stringify(sel)}).then(x=>d(x)).catch(()=>d(null));`);
  if (u && u.startsWith('data:image/png;base64,')) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(u.split(',')[1], 'base64')); return true; }
  return false;
}
async function winShot(sid, name) {
  const j = await (await fetch(`${BASE}/session/${sid}/screenshot`)).json();
  if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); return true; }
  return false;
}

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// (1) The fixture curved arrow renders as a <path> in the editor canvas.
await sleep(600);
const editorHasPath = await exec(sid, "return !!document.querySelector('.el-arrow svg path')");
if (!editorHasPath) problems.push('editor: no <path> for the fixture curved arrow');
await shot(sid, '.slide-canvas', 'editor');
await winShot(sid, 'editor-window');

// (2) Inspector Shape=Curved materializes control points on the straight arrow.
await exec(sid, "var s=window.__eigendeck.store.getState(); s.selectObject({type:'element',id:'straight'}); s.setInspectorTab('element'); if(!s.showProperties) s.toggleProperties();");
for (let i = 0; i < 15; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.properties-panel .prop-section')")) break; }
const clicked = await exec(sid, `
  const sec=[...document.querySelectorAll('.properties-panel .prop-section')].find(s=>s.querySelector('.prop-label')?.textContent==='Shape');
  if(!sec) return 'no Shape section';
  const b=[...sec.querySelectorAll('button')].find(x=>x.textContent==='Curved');
  if(!b) return 'no Curved button'; b.click(); return 'ok';`);
if (clicked !== 'ok') problems.push(`Shape toggle: ${clicked}`);
else { await sleep(300); const c = await exec(sid, "const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='straight');return JSON.stringify({c1x:e.c1x,c1y:e.c1y,c2x:e.c2x,c2y:e.c2y});"); const cp = JSON.parse(c); if (cp.c1x == null || cp.c2y == null) problems.push(`Curved toggle did not set control points: ${c}`); }

// Screenshot the curved arrow SELECTED so the Inkscape control handles show.
await exec(sid, "window.__eigendeck.store.getState().selectObject({type:'element',id:'curved'});");
await sleep(400);
await winShot(sid, 'handles-window');

// (3) HTML export emits a <path> for a curved arrow.
const html = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.exportHtml().then(h=>d(h)).catch(e=>d('ERR:'+e));");
if (typeof html !== 'string' || html.startsWith('ERR:')) problems.push(`export failed: ${html}`);
else if (!/<path d="M [\d.]+ [\d.]+ C /.test(html)) problems.push('HTML export has no cubic <path> for the curved arrow');

// (4) Present mode renders a <path>.
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0); window.__eigendeck.store.getState().setPresenting(true);");
await sleep(1200);
const presentHasPath = await exec(sid, "return !!document.querySelector('svg path')");
if (!presentHasPath) problems.push('present mode: no <path> rendered');
await shot(sid, 'body', 'present');
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`SPLINE_PASS: curved arrow renders <path> in editor+present+export; Shape toggle sets control points; PNGs → ${OUT}/`);
process.exit(0);
