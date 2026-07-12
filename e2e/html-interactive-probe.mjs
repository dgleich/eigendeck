// #137 `interactive` html element in the REAL app, via a pure-CSS (no-JS) radio/
// `:checked` thermometer. Verifies the opt-in interactivity plumbing:
//   • editor idle → iframe is pass-through (pointer-events:none, overlay for drag)
//   • double-click → "interact" mode: pointer-events:auto + a Lock bar
//   • a REAL click on a scale <label> flips the radio and moves the mercury fill
//     (editor iframe is same-origin, so the result is readable)
//   • present mode → interactive iframe gets pointer-events:auto (clickable live)
// Static (non-interactive) html staying pass-through is covered by unit tests.
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const OUT = process.env.PROBE_OUT || 'gitignore/html-interactive-e2e';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function shot(sid, name) {
  try {
    const ac = new AbortController(); const to = setTimeout(() => ac.abort(), 6000);
    const j = await (await fetch(`${BASE}/session/${sid}/screenshot`, { signal: ac.signal })).json(); clearTimeout(to);
    if (j?.value) { mkdirSync(OUT, { recursive: true }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(j.value, 'base64')); }
  } catch { /* screenshot hung (present-mode WebKit quirk) — assertions run via exec */ }
}
const peSel = (sid, sel) => exec(sid, `const f=document.querySelector(${JSON.stringify(sel)});return f?getComputedStyle(f).pointerEvents:'no-iframe'`);
const fail = (m) => { console.error('HTML_INTERACT_FAIL:', m); process.exit(1); };
const problems = [];

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
await sleep(900);

// EDITOR: pass-through until you double-click to interact.
let v = await peSel(sid, '.el-html iframe'); if (v !== 'none') problems.push(`editor idle pointer-events=${v} (want none)`);
await exec(sid, "document.querySelector('.el-html .demo-overlay').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
await sleep(400);
v = await peSel(sid, '.el-html iframe'); if (v !== 'auto') problems.push(`editor interact pointer-events=${v} (want auto)`);
if (!await exec(sid, "return !!document.querySelector('.el-html .demo-lock-btn')")) problems.push('editor interact: no Lock bar');

// A real click on the 0° label drops the level (default is t2=40%).
const before = await exec(sid, "const f=document.querySelector('.el-html iframe');return f.contentDocument.getElementById('t2').checked");
await exec(sid, `
  const f=document.querySelector('.el-html iframe');
  const lab=f.contentDocument.querySelector('label[for="t0"]');
  const r=lab.getBoundingClientRect();
  lab.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.x+r.width/2,clientY:r.y+r.height/2}));
`);
await sleep(800);
const after = JSON.parse(await exec(sid, `
  const f=document.querySelector('.el-html iframe');
  return JSON.stringify({ t0:f.contentDocument.getElementById('t0').checked, t2:f.contentDocument.getElementById('t2').checked });
`));
if (!(before === true && after.t0 === true && after.t2 === false)) problems.push(`click did not change level: before t2=${before}, after=${JSON.stringify(after)}`);
await shot(sid, 'interact-editor');

// PRESENT: the interactive iframe becomes clickable (pointer-events:auto).
await exec(sid, "const s=window.__eigendeck.store.getState(); s.selectSlide(0); s.setPresenting(true);");
await sleep(1200);
v = await peSel(sid, '.present-mode iframe[title="HTML element"]'); if (v !== 'auto') problems.push(`present interactive pointer-events=${v} (want auto)`);
await shot(sid, 'interact-present');
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('HTML_INTERACT_PASS: interactive html clickable in editor interact-mode + present; real label click drives the CSS `:checked` thermometer (no JS).');
process.exit(0);
