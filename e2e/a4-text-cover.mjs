// a4 — text box-level props (backgroundColor+opacity, boxShadow, borderRadius,
// rotation, textEffect shadow, verticalAlign, padding) + cover fill across
// editor(#1)/present(#2)/thumbnail(#7)/export(#4). Text `txt`: bg #ffcc00 @0.8,
// boxShadow, radius 24, rotation 12, textEffect shadow, valign middle,
// padding 40/50. Cover `cov`: color #123456.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('TXTCOV_FAIL:', m); process.exit(1); };

// text wrapper reader
const readTextWrap = (root) => `
  const w = document.querySelector(${JSON.stringify(root)} + ' .el-text');
  if (!w) return { err: 'no .el-text under ${root}' };
  const cs = getComputedStyle(w);
  // inner content div (has text-shadow / padding / valign)
  const fo = w.querySelector('foreignObject');
  const contentDiv = fo ? fo.querySelector('div > div') : null;
  const innerCs = contentDiv ? getComputedStyle(contentDiv) : null;
  const valignWrap = fo ? fo.querySelector('div') : null;
  const valignCs = valignWrap ? getComputedStyle(valignWrap) : null;
  return {
    bg: cs.backgroundColor, boxShadow: cs.boxShadow, radius: cs.borderTopLeftRadius, transform: cs.transform,
    textShadow: innerCs ? innerCs.textShadow : null,
    padding: innerCs ? innerCs.padding : null,
    justify: valignCs ? valignCs.justifyContent : null,
  };
`;
const readCover = (root, cls) => `
  const els = [...document.querySelectorAll(${JSON.stringify(root)} + ' ' + ${JSON.stringify(cls)})];
  // find the one whose bg is the cover color
  for (const e of els) { const cs = getComputedStyle(e); if (cs.backgroundColor === 'rgb(18, 52, 86)') return { bg: cs.backgroundColor }; }
  return { bgs: els.map(e => getComputedStyle(e).backgroundColor) };
`;

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await exec(sid, `window.__eigendeck.store.getState().selectSlide(0);`);
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.el-text foreignObject')")) break; }

const ed = await exec(sid, readTextWrap('.slide-canvas'));
const edCov = await exec(sid, readCover('.slide-canvas', '.el-cover div'));

await exec(sid, `window.__eigendeck.store.getState().setPresenting(true); window.__eigendeck.store.getState().selectSlide(0);`);
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-slide .el-text foreignObject')")) break; }
const pr = await exec(sid, readTextWrap('.present-slide'));
const prCov = await exec(sid, readCover('.present-slide', 'div'));
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");

await sleep(500);
const th = await exec(sid, `
  const th = document.querySelector('.slide-thumb-render');
  if (!th) return { err: 'no thumb-render' };
  const w = th.querySelector('.el-text') || th.querySelector('svg');
  const parent = w && w.closest('div');
  // thumbnail text uses TextElementSvg -> the wrapping div gets bg/shadow/radius/rotation
  const wrap = th.querySelector('.el-text');
  const cs = wrap ? getComputedStyle(wrap) : (parent ? getComputedStyle(parent) : null);
  const covHit = [...th.querySelectorAll('div')].some(d => getComputedStyle(d).backgroundColor === 'rgb(18, 52, 86)');
  return cs ? { bg: cs.backgroundColor, boxShadow: cs.boxShadow, radius: cs.borderTopLeftRadius, transform: cs.transform, covHit } : { err: 'no text wrap in thumb', covHit };
`);

const html = await execA(sid, `const d=arguments[arguments.length-1];Promise.resolve(window.__eigendeck.exportHtml()).then(h=>d(h)).catch(e=>d('ERR:'+e));`);
const exp = {};
if (typeof html === 'string' && !html.startsWith('ERR:')) {
  exp.hasRotate = /rotate\(12deg\)/.test(html);
  exp.hasRadius = /border-radius:24px/.test(html) || /border-radius: 24px/.test(html);
  exp.hasShadow = /box-shadow:/.test(html);
  exp.hasTextShadow = /text-shadow:/.test(html);
  exp.hasCover = /background:#123456/.test(html) || /123456/.test(html);
  exp.hasValign = /justify-content:center/.test(html);
} else problems.push(`export: ${html}`);

console.log('TXTCOV_REPORT:', JSON.stringify({ editor: ed, editorCover: edCov, present: pr, presentCover: prCov, thumbnail: th, export: exp }, null, 2));

// Parity checks vs editor
function nonZero(v) { return v && v !== '0px' && v !== 'none'; }
for (const [name, v] of [['present', pr], ['thumbnail', th]]) {
  if (!v || v.err) { problems.push(`${name}: ${v?.err || 'no data'}`); continue; }
  if (ed.bg !== v.bg) problems.push(`${name.toUpperCase()} text bg ${v.bg} != editor ${ed.bg}`);
  if (nonZero(ed.radius) && !nonZero(v.radius)) problems.push(`${name.toUpperCase()} text borderRadius dropped (editor ${ed.radius})`);
  if (nonZero(ed.boxShadow) && !nonZero(v.boxShadow)) problems.push(`${name.toUpperCase()} text boxShadow dropped`);
  if (nonZero(ed.transform) && !nonZero(v.transform)) problems.push(`${name.toUpperCase()} text rotation dropped`);
}
// inner shadow/valign/padding only readable in editor+present (thumb foreignObject too)
if (pr && !pr.err) {
  if (nonZero(ed.textShadow) && !nonZero(pr.textShadow)) problems.push(`PRESENT text textEffect(shadow) dropped`);
  if (ed.justify && pr.justify && ed.justify !== pr.justify) problems.push(`PRESENT valign ${pr.justify} != editor ${ed.justify}`);
  if (ed.padding && pr.padding && ed.padding !== pr.padding) problems.push(`PRESENT padding ${pr.padding} != editor ${ed.padding}`);
}
if (th && th.covHit === false) problems.push('THUMBNAIL cover fill dropped');
if (prCov && prCov.bgs) problems.push('PRESENT cover fill not found (' + JSON.stringify(prCov.bgs) + ')');
if (exp.hasRotate === false) problems.push('EXPORT text rotation dropped');
if (exp.hasCover === false) problems.push('EXPORT cover fill dropped');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('TXTCOV_PASS: text box props + cover fill consistent across paths');
process.exit(0);
