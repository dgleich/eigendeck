// #137 raw-HTML element in the REAL app. Verifies (1) the editor renders the
// element as a same-origin (script-less) iframe whose contentDocument actually
// holds the authored markup, (2) the injected CSP + no allow-scripts are present,
// (3) double-click makes the framed body contentEditable (the best-effort in-place
// edit path — untestable in jsdom), (4) HTML export emits a locked sandboxed
// iframe. Screenshots the editor for eyeballing.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-element-e2e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function winShot(sid, name) { const j = await (await fetch(`${BASE}/session/${sid}/screenshot`)).json(); if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); } }
const fail = (m) => { console.error('HTML_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(800);

// (1)+(2) The editor iframe is same-origin (contentDocument readable), holds the
// authored markup, and its srcdoc carries the CSP + a script-less sandbox.
const info = await exec(sid, `
  const f = document.querySelector('.el-html iframe');
  if (!f) return JSON.stringify({ err: 'no iframe' });
  const sandbox = f.getAttribute('sandbox');
  const srcdoc = f.getAttribute('srcdoc') || '';
  let bodyHtml = null;
  try { bodyHtml = f.contentDocument && f.contentDocument.body ? f.contentDocument.body.innerHTML : null; } catch (e) { bodyHtml = 'THREW:' + e; }
  return JSON.stringify({ sandbox, hasCSP: srcdoc.includes("default-src 'none'"), noScripts: !sandbox.includes('allow-scripts'), bodyHasMarkup: !!bodyHtml && bodyHtml.includes('EIGEN') });
`);
const j = JSON.parse(info || '{}');
if (j.err) problems.push(`editor: ${j.err}`);
else {
  if (j.sandbox !== 'allow-same-origin') problems.push(`editor sandbox=${JSON.stringify(j.sandbox)} (expected allow-same-origin)`);
  if (!j.hasCSP) problems.push('editor srcdoc missing CSP');
  if (!j.noScripts) problems.push('editor sandbox has allow-scripts (must not)');
  if (!j.bodyHasMarkup) problems.push('editor iframe did not render the authored markup (contentDocument)');
}
await winShot(sid, 'editor');

// (3) Double-click the overlay → the framed body becomes contentEditable.
const editable = await exec(sid, `
  const ov = document.querySelector('.el-html .demo-overlay');
  if (!ov) return 'no overlay';
  ov.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return 'clicked';
`);
if (editable !== 'clicked') problems.push(`overlay: ${editable}`);
else {
  await sleep(500);
  const ce = await exec(sid, `
    const f = document.querySelector('.el-html iframe');
    try { return !!(f && f.contentDocument && f.contentDocument.body && f.contentDocument.body.isContentEditable); } catch (e) { return 'THREW:' + e; }
  `);
  if (ce !== true) problems.push(`double-click did not enable contentEditable (got ${ce})`);
  await winShot(sid, 'editing');
}

// (4) HTML export emits a locked sandboxed iframe (no allow-scripts).
const html = await execA(sid, "const d=arguments[arguments.length-1];window.__eigendeck.exportHtml().then(h=>d(h)).catch(e=>d('ERR:'+e));");
if (typeof html !== 'string' || html.startsWith('ERR:')) problems.push(`export failed: ${html}`);
else {
  if (!/sandbox=""/.test(html)) problems.push('export missing locked sandbox iframe');
  if (/allow-scripts/.test(html)) problems.push('export iframe has allow-scripts (must not)');
  if (!html.includes('EIGEN')) problems.push('export missing the authored markup');
}

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`HTML_PASS: same-origin script-less iframe renders authored markup + CSP; double-click → contentEditable; export locked. PNGs → ${OUT}/`);
process.exit(0);
