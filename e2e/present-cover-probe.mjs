// Present mode must fully black out the page so no light editor UI peeks behind the
// overlay — the reported "white bar at the bottom" on a black slide when the mouse
// leaves the window (macOS overlay scrollbars retract → 100vh sliver of the #f0f0f0
// app root). Fix: .present-mode uses inset:0, and body.presenting blacks the root +
// locks scroll. Assert the class/styles + that the overlay reaches the viewport edges.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const fail = (m) => { console.error('PRESENTCOVER_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
for (let i = 0; i < 20; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.present-mode')")) break; }

const r = await exec(sid, `
  const el = document.querySelector('.present-mode');
  if (!el) return { err: 'no .present-mode' };
  const cs = getComputedStyle(document.body);
  const b = el.getBoundingClientRect();
  return {
    hasClass: document.body.classList.contains('presenting'),
    bodyBg: cs.backgroundColor,
    bodyOverflow: cs.overflow,
    coversBottom: b.bottom >= window.innerHeight && b.top <= 0 && b.left <= 0 && b.right >= window.innerWidth,
    bottomGap: window.innerHeight - b.bottom,
  };
`);
if (!r || r.err) fail(r?.err || 'no result');
if (!r.hasClass) problems.push('body is missing the .presenting class');
if (r.bodyBg !== 'rgb(0, 0, 0)') problems.push(`body background ${r.bodyBg} != black (a sliver would show light)`);
if (!/hidden/.test(r.bodyOverflow)) problems.push(`body overflow ${r.bodyOverflow} != hidden (scrollbar can shift the viewport)`);
if (!r.coversBottom) problems.push(`.present-mode does not cover the viewport (bottom gap ${r.bottomGap}px)`);

// Leaving present mode must restore the page (class removed).
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
await sleep(400);
if (await exec(sid, "return document.body.classList.contains('presenting')")) problems.push('body still has .presenting after leaving present');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('PRESENTCOVER_PASS: present blacks out the root (body.presenting #000, overflow hidden) + overlay reaches the viewport edges; cleaned up on exit');
process.exit(0);
