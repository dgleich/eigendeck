// Notebook-output isolation e2e (docs/NOTEBOOK-ISOLATION.md, audit C-1/C-2/C-5).
// Opens the fixture deck, selects the notebook slide, and asserts:
//   1. the INTERACTIVE output ran (proves interactivity survives)…
//   2. …but from an OPAQUE origin with NO access to window.top.__TAURI_INTERNALS__
//      (proves containment — the C-1 fix)
//   3. the MARKDOWN <img onerror> never fired (proves markdown sanitization)
//   4. DOM shape: interactive output is an iframe.el-demo-frame; the static
//      output renders inline (STATICMARK present, not in an iframe)
// Payloads self-report via postMessage({__nbprobe:1,…}) collected in the parent.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(s, x) { return (await post(`/session/${s}/execute/sync`, { script: x, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(s) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(s, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('NBSEC_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
// Collect self-reports from the notebook output payloads.
await exec(sid, `window.__nb=[]; window.addEventListener('message',e=>{var d=e.data; if(d&&d.__eigendeck!==1&&d.__nbprobe===1)window.__nb.push(d);});`);
await exec(sid, `window.__eigendeck.store.getState().selectSlide(0);`);

// Wait for the notebook + its output iframe to mount and the payload to report.
let reports = [];
for (let k = 0; k < 20; k++) {
  await sleep(600);
  reports = await exec(sid, `return window.__nb`) || [];
  if (reports.some((r) => r.ran)) break;
}
const dom = await exec(sid, `
  const frames=[...document.querySelectorAll('iframe.el-demo-frame')];
  return {
    frames: frames.length,
    sandbox: frames.map(f=>f.getAttribute('sandbox')),
    staticInline: !!document.body.textContent.match(/STATICMARK/),
    mdRendered: !!document.body.textContent.match(/MDTitle/),
  };`);

console.log('  reports:', JSON.stringify(reports));
console.log('  dom:', JSON.stringify(dom));

// 1. interactivity: the script ran
const ran = reports.find((r) => r.ran);
if (!ran) fail('interactive output script never ran (interactivity broken)');
// 2. containment: the output cannot reach window.top.__TAURI_INTERNALS__. A
//    SecurityError (cross-origin) or `absent` both mean no reach; REACHED = breach.
//    (location.origin reports the blob's base origin even when the EFFECTIVE origin
//    is opaque, so the Tauri-reach probe is the real containment signal.)
if (ran.tauri === 'REACHED') fail('CONTAINMENT BREACH: output reached window.top.__TAURI_INTERNALS__');
if (!String(ran.tauri).startsWith('blocked') && ran.tauri !== 'absent') fail(`unexpected tauri probe result: ${ran.tauri}`);
// 3. markdown: rendered, but the <img onerror> was sanitized so never fired
if (!dom.mdRendered) fail('markdown cell did not render (no-mdpwn assertion would be vacuous)');
if (reports.some((r) => r.mdpwn)) fail('markdown <img onerror> FIRED — sanitization bypassed');
// 4. DOM shape: interactive → opaque iframe; static → inline
if (!dom || dom.frames < 1) fail('interactive output did not mount an el-demo-frame iframe');
if (!dom.sandbox.every((s) => s === 'allow-scripts')) fail(`iframe sandbox not opaque: ${JSON.stringify(dom.sandbox)}`);
if (!dom.staticInline) fail('static output (STATICMARK) not rendered inline');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log(`NBSEC_PASS: interactive output ran + contained (tauri=${ran.tauri}); markdown rendered + sanitized; static inline`);
process.exit(0);
