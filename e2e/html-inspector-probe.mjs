// #137 raw-HTML element — INSPECTOR editing (real UI, not the store shortcut).
// Select the element → open the Element tab → find the "Raw HTML" <textarea> in
// .properties-panel, set its value + dispatch a React-compatible input event, and
// assert (a) the store's element.html updated and (b) the editor iframe's srcdoc
// re-rendered with the new markup. Then drive the Background: change background
// via the store's updateElement (the ColorControl's onColor sink) and assert the
// iframe srcdoc carries `background:<color>`.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-inspector';
const NEW_HTML = '<p id="viaInspectorEIGEN">INSPECTOR-EDIT-99</p>';
const NEW_BG = '#abcdef';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function winShot(sid, name) { const j = await (await fetch(`${BASE}/session/${sid}/screenshot`)).json(); if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); } }
const fail = (m) => { console.error('HTML_INSP_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(900);

// Open the inspector (default-hidden), select the element, open the Element tab.
await exec(sid, `
  const s = window.__eigendeck.store.getState();
  if (!s.showProperties) s.toggleProperties();
  s.selectObject({ type: 'element', id: 'raw' });
  s.setInspectorTab && s.setInspectorTab('element');
`);
await sleep(500);

// Find the Raw HTML textarea in .properties-panel and drive it as a real user
// would: set value via the native setter + dispatch an 'input' event so React's
// onChange fires (which calls updateElement).
const drove = await exec(sid, `
  const panel = document.querySelector('.properties-panel');
  if (!panel) return 'no panel';
  const tas = [...panel.querySelectorAll('textarea')];
  // The Raw HTML textarea is pre-filled with the element's html — pick the one
  // whose current value matches the element markup.
  const cur = window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='raw').html;
  const ta = tas.find(t => t.value === cur) || tas[0];
  if (!ta) return 'no textarea';
  const proto = Object.getPrototypeOf(ta);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
  setter.call(ta, ${JSON.stringify(NEW_HTML)});
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return 'ok';
`);
if (drove !== 'ok') problems.push(`inspector textarea: ${drove}`);
await sleep(500);

const afterHtml = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='raw').html");
if (afterHtml !== NEW_HTML) problems.push(`store html did not update via inspector (got ${JSON.stringify((afterHtml||'').slice(0,60))})`);
const srcdocHasNew = await exec(sid, `
  const f = document.querySelector('.el-html iframe');
  return !!(f && (f.getAttribute('srcdoc')||'').includes('INSPECTOR-EDIT-99'));
`);
if (!srcdocHasNew) problems.push('editor iframe srcdoc did not re-render with the inspector edit');
await winShot(sid, 'after-html-edit');

// Background: drive the ColorControl's onColor sink (updateElement background).
await exec(sid, `window.__eigendeck.store.getState().updateElement('raw', { background: ${JSON.stringify(NEW_BG)} });`);
await sleep(400);
const bg = JSON.parse(await exec(sid, `
  const el = window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='raw');
  const f = document.querySelector('.el-html iframe');
  const srcdoc = f ? (f.getAttribute('srcdoc')||'') : '';
  return JSON.stringify({ elBg: el.background, srcdocHasBg: srcdoc.includes('background:${NEW_BG}') });
`));
if (bg.elBg !== NEW_BG) problems.push(`background not set on element (got ${JSON.stringify(bg.elBg)})`);
if (!bg.srcdocHasBg) problems.push(`iframe srcdoc missing background:${NEW_BG}`);
await winShot(sid, 'after-bg');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`HTML_INSP_PASS: inspector textarea edit updated store.html + re-rendered srcdoc; background change reached element + srcdoc (background:${NEW_BG}). PNGs → ${OUT}/`);
process.exit(0);
