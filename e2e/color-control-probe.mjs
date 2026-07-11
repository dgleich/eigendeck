// The unified <ColorControl> (Milestone 2) driving the REAL inspector: picking the
// theme-accent tint in Text Color writes the live token (color:'accent'); picking a
// fill tint on a cover writes boxTint; and the deck customPalette swatch now appears
// on the Background control (it was missing before). Verifies the click → store-write
// chain in WebKit (jsdom characterization net is PropertiesPanel.colorControls.test).
// Screenshots the inspector for eyeballing the unified swatch row.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/color-control-e2e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('CTRL_FAIL:', m); process.exit(1); };
const elColor = (sid, id) => exec(sid, `const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='${id}');return JSON.stringify({color:e.color,boxTint:e.boxTint});`);

// Select an element + open the inspector on its element tab.
async function inspect(sid, id) {
  await exec(sid, `var s=window.__eigendeck.store.getState(); s.selectObject({type:'element',id:'${id}'}); s.setInspectorTab('element'); if(!s.showProperties) s.toggleProperties();`);
  for (let i = 0; i < 15; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.properties-panel .prop-section')")) return true; }
  return false;
}
// Click the swatch with a title starting `prefix` inside the PropSection labelled `label`.
async function clickSwatch(sid, label, prefix) {
  return exec(sid, `
    const sec=[...document.querySelectorAll('.properties-panel .prop-section')].find(s=>s.querySelector('.prop-label')?.textContent===${JSON.stringify(label)});
    if(!sec) return 'no section '+${JSON.stringify(label)};
    const b=[...sec.querySelectorAll('button.prop-color-swatch')].find(x=>(x.getAttribute('title')||'').startsWith(${JSON.stringify(prefix)}));
    if(!b) return 'no swatch '+${JSON.stringify(prefix)};
    b.click(); return 'ok';
  `);
}

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// --- Text Color: the accent tint writes the live token ---
if (!await inspect(sid, 'txt')) fail('inspector did not open for txt');
let r = await clickSwatch(sid, 'Text Color', 'Theme accent');
if (r !== 'ok') problems.push(`text accent swatch: ${r}`);
else { const c = JSON.parse(await elColor(sid, 'txt')); if (c.color !== 'accent') problems.push(`text color=${c.color} (expected 'accent')`); }

// --- Background control now shows the deck customPalette (#ff00ff) — new affordance ---
const hasCustom = await exec(sid, `
  const sec=[...document.querySelectorAll('.properties-panel .prop-section')].find(s=>s.querySelector('.prop-label')?.textContent==='Background');
  if(!sec) return false;
  return [...sec.querySelectorAll('button.prop-color-swatch')].some(x=>(x.getAttribute('title')||'').includes('#ff00ff'));
`);
if (!hasCustom) problems.push('Background control missing the deck customPalette swatch (#ff00ff)');

// screenshot the inspector with the unified controls
const shot = await execA(sid, `const d=arguments[arguments.length-1];window.__eigendeck.captureElement('.properties-panel').then(u=>d(u)).catch(()=>d(null));`);
if (shot && shot.startsWith('data:image/png;base64,')) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/inspector-text.png`, Buffer.from(shot.split(',')[1], 'base64')); }

// --- Cover: a fill tint writes boxTint (new: cover gained themed tints) ---
if (!await inspect(sid, 'cov')) fail('inspector did not open for cov');
r = await clickSwatch(sid, 'Color', 'Theme accent');
if (r !== 'ok') problems.push(`cover accent tint: ${r}`);
else { const c = JSON.parse(await elColor(sid, 'cov')); if (c.boxTint !== 'accent') problems.push(`cover boxTint=${c.boxTint} (expected 'accent')`); if (c.color) problems.push(`cover color not cleared (${c.color})`); }

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log(`CTRL_PASS: <ColorControl> writes accent token (text) + boxTint (cover) + shows deck palette on Background; inspector PNG → ${OUT}/`);
process.exit(0);
