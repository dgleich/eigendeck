// #137 raw-HTML element — SIDEBAR THUMBNAIL render + lock. The sidebar thumbnail
// (SlideThumbnail → PresentElement) must render the html element as a LOCKED
// iframe (sandbox="") carrying the CSP + authored markup — same isolation as
// present/export, no drift. Screenshot the sidebar for eyeballing.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-thumbnail';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function winShot(sid, name) { const j = await (await fetch(`${BASE}/session/${sid}/screenshot`)).json(); if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); } }
const fail = (m) => { console.error('HTML_THUMB_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(1100);

const info = JSON.parse(await exec(sid, `
  // The sidebar thumbnail lives under .slide-thumb-render; find the html iframe there.
  const scope = document.querySelector('.slide-thumb-render') || document;
  const f = scope.querySelector('iframe[title="HTML element"]');
  if (!f) return JSON.stringify({ err: 'no thumbnail html iframe' });
  const srcdoc = f.getAttribute('srcdoc') || '';
  return JSON.stringify({
    sandbox: f.getAttribute('sandbox'),
    hasScriptsAttr: (f.getAttribute('sandbox')||'').includes('allow-scripts'),
    hasCSP: srcdoc.includes("default-src 'none'"),
    hasMarkup: srcdoc.includes('EIGEN'),
  });
`));
if (info.err) problems.push(`thumbnail: ${info.err}`);
else {
  if (info.sandbox !== '') problems.push(`thumbnail sandbox=${JSON.stringify(info.sandbox)} (expected "" locked)`);
  if (info.hasScriptsAttr) problems.push('thumbnail iframe has allow-scripts (must not)');
  if (!info.hasCSP) problems.push('thumbnail srcdoc missing CSP');
  if (!info.hasMarkup) problems.push('thumbnail srcdoc missing authored markup');
}
await winShot(sid, 'sidebar');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`HTML_THUMB_PASS: sidebar thumbnail renders the html element as a locked iframe (sandbox="", no allow-scripts) with CSP + markup. PNG → ${OUT}/`);
process.exit(0);
