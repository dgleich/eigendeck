// Minimal smoke: opens the app on the E2E_BASE port, waits for the seam, reports the
// deck's slide count. Used to prove run-probe-parallel port isolation.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
const sid = await open(); if (!sid) { console.error('SMOKE_FAIL: no session on', BASE); process.exit(1); }
let ok = false; for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) { ok = true; break; } }
const n = ok ? await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length") : -1;
await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (!ok) { console.error('SMOKE_FAIL: no seam on', BASE); process.exit(1); }
console.log(`SMOKE_PASS: ${BASE} → seam up, ${n} slides`);
process.exit(0);
