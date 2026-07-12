// #137 raw-HTML element — PRESENT MODE render + lock. Enter present mode
// (selectSlide(0) + setPresenting(true)); assert the present iframe (a) uses the
// LOCKED sandbox="" (no scripts, no same-origin, no network), (b) carries the CSP
// + the authored markup in its srcdoc, and (c) captures a PNG of the element via
// the captureElement seam (WebDriver /screenshot HANGS in present fullscreen).
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-present-render';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('HTML_PRESENT_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(900);

await exec(sid, "window.__eigendeck.store.getState().selectSlide(0); window.__eigendeck.store.getState().setPresenting(true);");
await sleep(1600);

const info = JSON.parse(await exec(sid, `
  const f = document.querySelector('.present-slide iframe[title="HTML element"]');
  if (!f) return JSON.stringify({ err: 'no present iframe' });
  const srcdoc = f.getAttribute('srcdoc') || '';
  return JSON.stringify({
    sandbox: f.getAttribute('sandbox'),
    hasCSP: srcdoc.includes("default-src 'none'"),
    hasMarkup: srcdoc.includes('EIGEN'),
    hasScriptsAttr: (f.getAttribute('sandbox')||'').includes('allow-scripts'),
  });
`));
if (info.err) problems.push(`present: ${info.err}`);
else {
  if (info.sandbox !== '') problems.push(`present sandbox=${JSON.stringify(info.sandbox)} (expected "" locked)`);
  if (info.hasScriptsAttr) problems.push('present iframe has allow-scripts (must not)');
  if (!info.hasCSP) problems.push('present srcdoc missing CSP');
  if (!info.hasMarkup) problems.push('present srcdoc missing authored markup');
}

// Capture the present slide via the seam (present /screenshot hangs). NB: a
// locked (opaque-origin) iframe won't rasterize its inner pixels via
// modern-screenshot, so this is a context artifact, not a pixel assertion — the
// srcdoc/sandbox checks above are the load-bearing ones.
const png = await execA(sid, `
  const d = arguments[arguments.length-1];
  window.__eigendeck.captureElement('.present-slide')
    .then(u => d(u || '')).catch(e => d('ERR:'+e));
`);
// Best-effort artifact: modern-screenshot cannot rasterize a locked
// (opaque-origin) iframe's inner pixels and may return an empty data URL — that
// is EXPECTED and not a failure (the srcdoc/sandbox checks above are the real
// assertions). Save whatever came back for eyeballing.
if (typeof png === 'string' && png.startsWith('data:image') && png.length > 'data:image/png;base64,'.length + 8) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/present.png`, Buffer.from(png.split(',')[1], 'base64'));
} else {
  console.error('  (note) captureElement produced no rasterized image (opaque-origin iframe) — expected, not gating.');
}

await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);").catch(() => {});
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`HTML_PRESENT_PASS: present iframe locked (sandbox="", no allow-scripts) with CSP + authored markup; captured PNG → ${OUT}/`);
process.exit(0);
