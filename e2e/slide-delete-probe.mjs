// Deleting a slide from the sidebar "X" must CONFIRM FIRST, then delete — the raw
// window.confirm() returned a truthy Promise under Tauri, so the slide was deleted
// and the dialog only appeared AFTER (SlideSidebar now awaits askConfirm). Drives the
// confirm via the dev/seam-only window.__eigendeckConfirm one-shot: with the answer
// FALSE the slide must survive; with TRUE it's removed. Proves the gate + the order.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('SLIDEDEL_FAIL:', m); process.exit(1); };
const count = (sid) => exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length;");
// Set the one-shot confirm answer, then click a slide's Delete button (JS click fires
// the handler even though the button only shows on hover).
async function clickDelete(sid, answer) {
  await exec(sid, `window.__eigendeckConfirm = ${answer};`);
  const ok = await exec(sid, `const b=document.querySelector('.slide-thumbnail .slide-actions button[title="Delete"]'); if(!b) return false; b.click(); return true;`);
  if (!ok) fail('no slide Delete (X) button found');
  await sleep(500); // async askConfirm + re-render
}

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

if (await count(sid) !== 3) problems.push(`expected 3 slides at start, got ${await count(sid)}`);

// Answer NO → slide must survive (the old bug deleted it regardless).
await clickDelete(sid, false);
if (await count(sid) !== 3) problems.push(`after Cancel: expected 3 slides, got ${await count(sid)} (deleted despite cancel!)`);

// Answer YES → one slide removed.
await clickDelete(sid, true);
if (await count(sid) !== 2) problems.push(`after Confirm: expected 2 slides, got ${await count(sid)}`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('SLIDEDEL_PASS: sidebar X confirms BEFORE deleting — Cancel keeps the slide, Confirm removes it');
process.exit(0);
