// Open a built showcase.eigendeck in the real app (read-only) and write the
// self-contained HTML export for the website carousel. Read-only: we never
// save(), so the editor's incremental flush never runs — the deck is built
// deterministically by `eigendeck-cli import json` (see build-showcase.mjs).
//
// Drive via the eigendeck-e2e rig:
//   PROBE=export-showcase.mjs E2E_DECK=<deck> OUT=<out.html> bash run-probe.sh
// Optional: SHOTS="0,1,4" writes /tmp/showcase-s<idx>.png for visual checks.
import { writeFileSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK, OUT = process.env.OUT || '/tmp/showcase.html';
const SHOTS = (process.env.SHOTS || '').split(',').map(s => s.trim()).filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value }
async function execA(sid, s) { return (await post(`/session/${sid}/execute/async`, { script: s, args: [] }))?.value }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
const fail = m => { console.error('FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('open');
let ok = false;
for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) { ok = true; break; } }
if (!ok) fail('seam');
const nslides = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
console.log('  slides loaded:', nslides);
await exec(sid, "var s=window.__eigendeck.store.getState(); if(s.showProperties) s.toggleProperties();");

for (const idx of SHOTS) {
  await exec(sid, `window.__eigendeck.store.getState().selectSlide(${idx}); window.__eigendeck.store.getState().selectObject({type:'slide'});`);
  await sleep(2400);
  try { const r = await fetch(`${BASE}/session/${sid}/screenshot`); const j = await r.json(); if (typeof j?.value === 'string') { writeFileSync(`/tmp/showcase-s${idx}.png`, Buffer.from(j.value, 'base64')); console.log(`  shot /tmp/showcase-s${idx}.png`); } } catch (e) { console.log('  shot failed', e + ''); }
}

const html = await execA(sid, `const done=arguments[arguments.length-1]; Promise.resolve().then(()=>window.__eigendeck.exportHtml()).then(h=>done(h)).catch(e=>done('ERR:'+e));`);
if (typeof html !== 'string' || html.startsWith('ERR')) fail('export ' + String(html).slice(0, 120));
writeFileSync(OUT, html);
console.log('  exported', (html.length / 1048576).toFixed(1), 'MB ->', OUT);
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('OK');
process.exit(0);
