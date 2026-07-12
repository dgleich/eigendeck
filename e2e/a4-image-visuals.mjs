// a4 — image visual props (shadow / borderRadius / opacity / rotation) across
// render paths. Compares editor (#1), present (#2), thumbnail (#7), export (#4).
// The image element `imgVis` carries: shadow=true, borderRadius=40, opacity=0.5,
// rotation=30.  Reads computed style of the <img> in each React path + scans the
// export HTML string.  Reports which paths DROP each prop.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('IMGVIS_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

await exec(sid, `window.__eigendeck.store.getState().selectSlide(0);`);
// wait for editor img
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.el-image img')")) break; }

// helper: read the computed visual props from an <img> under a selector
const readImg = (sel) => `
  const img = document.querySelector(${JSON.stringify(sel)});
  if (!img) return { err: 'no img for ${sel}' };
  const cs = getComputedStyle(img);
  return { filter: cs.filter, borderRadius: cs.borderTopLeftRadius, opacity: cs.opacity, transform: cs.transform };
`;

// ---- editor (#1) ----
const ed = await exec(sid, readImg('.el-image img'));
if (ed?.err) problems.push(`editor: ${ed.err}`);

// ---- present (#2) ----
await exec(sid, `window.__eigendeck.store.getState().setPresenting(true); window.__eigendeck.store.getState().selectSlide(0);`);
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-slide img')")) break; }
const pr = await exec(sid, readImg('.present-slide img'));
if (pr?.err) problems.push(`present: ${pr.err}`);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");

// ---- thumbnail (#7) ----
await sleep(500);
const th = await exec(sid, `
  const th = document.querySelector('.slide-thumbnail') || document.querySelector('.slide-thumb-render');
  if (!th) return { err: 'no thumbnail' };
  const img = th.querySelector('img');
  if (!img) return { err: 'no thumbnail img' };
  const cs = getComputedStyle(img);
  return { filter: cs.filter, borderRadius: cs.borderTopLeftRadius, opacity: cs.opacity, transform: cs.transform };
`);
if (th?.err) problems.push(`thumbnail: ${th.err}`);

// ---- export (#4) ----
const html = await execA(sid, `const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.exportHtml()).then(h=>d(h)).catch(e=>d('ERR:'+e));`);
const exp = { hasFilter: false, hasRadius: false, hasOpacity: false, hasRotate: false };
if (typeof html === 'string' && !html.startsWith('ERR:')) {
  // find the <img> tag for our asset
  const m = html.match(/<img[^>]*>/g) || [];
  const imgTag = m.find((t) => /drop-shadow|border-radius|opacity|rotate/.test(t)) || m[0] || '';
  exp.tag = imgTag.slice(0, 260);
  exp.hasFilter = /filter:\s*drop-shadow/.test(imgTag);
  exp.hasRadius = /border-radius:\s*40/.test(imgTag);
  exp.hasOpacity = /opacity:\s*0?\.5/.test(imgTag);
  exp.hasRotate = /rotate\(30deg\)/.test(imgTag);
} else { problems.push(`export: ${html}`); }

const report = { editor: ed, present: pr, thumbnail: th, export: exp };
console.log('IMGVIS_REPORT:', JSON.stringify(report, null, 2));

// Evaluate parity. Editor is the reference (WYSIWYG anchor).
function has(v, kind) {
  if (!v || v.err) return null;
  if (kind === 'shadow') return v.filter && v.filter !== 'none';
  if (kind === 'radius') return v.borderRadius && v.borderRadius !== '0px';
  if (kind === 'opacity') return v.opacity && parseFloat(v.opacity) < 0.99;
  if (kind === 'rotate') return v.transform && v.transform !== 'none';
}
for (const kind of ['shadow', 'radius', 'opacity', 'rotate']) {
  const e = has(ed, kind), p = has(pr, kind), t = has(th, kind);
  if (e && !t) problems.push(`THUMBNAIL drops image ${kind} (editor renders it, thumbnail does not)`);
  if (e && !p) problems.push(`PRESENT drops image ${kind} (editor renders it, present does not)`);
}
if (has(ed, 'shadow') && !exp.hasFilter) problems.push('EXPORT drops image shadow (filter:drop-shadow missing)');
if (has(ed, 'radius') && !exp.hasRadius) problems.push('EXPORT drops image borderRadius');
if (has(ed, 'opacity') && !exp.hasOpacity) problems.push('EXPORT drops image opacity');
if (has(ed, 'rotate') && !exp.hasRotate) problems.push('EXPORT drops image rotation');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('IMGVIS_PASS: image visuals present across editor/present/thumbnail/export');
process.exit(0);
