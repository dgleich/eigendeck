// a4 — arrow visual props across render paths. Arrow `arrBoth`: strokeWidth=10,
// headSize=40, heads='both' (=> 2 triangles), opacity=0.4, color=#8b5cf6.
// Compares editor(#1), present(#2), thumbnail(#7), export(#4-HTML string).
// Asserts: correct # of head triangles (both=2), stroke width, opacity carried.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('ARROWVIS_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

await exec(sid, `window.__eigendeck.store.getState().selectSlide(0);`);
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.el-arrow svg polygon')")) break; }

// ---- editor (#1) ---- (the interactive arrow: has handle circles too)
const ed = await exec(sid, `
  const svg = document.querySelector('.el-arrow svg');
  if (!svg) return { err: 'no editor arrow svg' };
  const g = svg.querySelector('g');
  const polys = svg.querySelectorAll('polygon');
  const line = g ? g.querySelector('line') : null;
  return {
    triangles: polys.length,
    groupOpacity: g ? getComputedStyle(g).opacity : null,
    strokeWidth: line ? line.getAttribute('stroke-width') : null,
    stroke: line ? line.getAttribute('stroke') : null,
  };
`);
if (ed?.err) problems.push(`editor: ${ed.err}`);

// ---- present (#2) ----
await exec(sid, `window.__eigendeck.store.getState().setPresenting(true); window.__eigendeck.store.getState().selectSlide(0);`);
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-slide svg polygon')")) break; }
const pr = await exec(sid, `
  const svgs = [...document.querySelectorAll('.present-slide svg')].filter(s => s.querySelector('polygon'));
  const svg = svgs[0];
  if (!svg) return { err: 'no present arrow svg' };
  const g = svg.querySelector('g');
  const polys = svg.querySelectorAll('polygon');
  const line = g ? g.querySelector('line') : null;
  return {
    triangles: polys.length,
    groupOpacity: g ? getComputedStyle(g).opacity : null,
    strokeWidth: line ? line.getAttribute('stroke-width') : null,
  };
`);
if (pr?.err) problems.push(`present: ${pr.err}`);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");

// ---- thumbnail (#7) ----
await sleep(500);
const th = await exec(sid, `
  const th = document.querySelectorAll('.slide-thumbnail')[0] || document.querySelector('.slide-thumb-render');
  if (!th) return { err: 'no thumbnail' };
  const svg = [...th.querySelectorAll('svg')].find(s => s.querySelector('line'));
  if (!svg) return { err: 'no thumbnail arrow svg' };
  const g = svg.querySelector('g');
  const polys = svg.querySelectorAll('polygon');
  const line = g ? g.querySelector('line') : svg.querySelector('line');
  return {
    triangles: polys.length,
    groupOpacity: g ? getComputedStyle(g).opacity : null,
    strokeWidth: line ? line.getAttribute('stroke-width') : null,
  };
`);
if (th?.err) problems.push(`thumbnail: ${th.err}`);

// ---- export (#4) ----
const html = await execA(sid, `const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.exportHtml()).then(h=>d(h)).catch(e=>d('ERR:'+e));`);
const exp = {};
if (typeof html === 'string' && !html.startsWith('ERR:')) {
  // find the <g ...> containing polygons for our arrow
  const gm = html.match(/<g[^>]*>.*?<\/g>/gs) || [];
  const gArrow = gm.find((g) => /polygon/.test(g) && /8b5cf6/i.test(g)) || '';
  exp.triangles = (gArrow.match(/<polygon/g) || []).length;
  exp.hasOpacity = /opacity="0?\.4"/.test(gArrow);
  exp.strokeWidth = (gArrow.match(/stroke-width="(\d+)"/) || [])[1];
} else { problems.push(`export: ${html}`); }

console.log('ARROWVIS_REPORT:', JSON.stringify({ editor: ed, present: pr, thumbnail: th, export: exp }, null, 2));

// Editor is the reference: heads='both' => 2 triangles; strokeWidth 10; opacity 0.4.
const refTri = ed?.triangles;
for (const [name, v] of [['present', pr], ['thumbnail', th]]) {
  if (!v || v.err) continue;
  if (v.triangles !== refTri) problems.push(`${name.toUpperCase()} arrow triangle count ${v.triangles} != editor ${refTri} (heads='both' should be 2)`);
  if (v.strokeWidth != ed.strokeWidth) problems.push(`${name.toUpperCase()} arrow strokeWidth ${v.strokeWidth} != editor ${ed.strokeWidth}`);
  const eo = parseFloat(ed.groupOpacity), vo = parseFloat(v.groupOpacity);
  if (Number.isFinite(eo) && eo < 0.99 && !(Number.isFinite(vo) && Math.abs(vo - eo) < 0.05)) {
    problems.push(`${name.toUpperCase()} arrow opacity ${v.groupOpacity} != editor ${ed.groupOpacity}`);
  }
}
if (exp.triangles !== undefined && refTri && exp.triangles !== refTri) problems.push(`EXPORT arrow triangle count ${exp.triangles} != editor ${refTri}`);
if (exp.hasOpacity === false && parseFloat(ed?.groupOpacity) < 0.99) problems.push('EXPORT arrow missing opacity=0.4');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('ARROWVIS_PASS: arrow heads/stroke/opacity consistent across editor/present/thumbnail/export');
process.exit(0);
