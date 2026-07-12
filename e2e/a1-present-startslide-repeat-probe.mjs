// (a) Present must START on the editor's current slide (N != 0), not slide 0.
// (b) Repeated present<->escape cycles must not drift the slide, leak present DOM,
//     or leave body.presenting set.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function waitFor(sid, expr, want = true) { for (let i = 0; i < 30; i++) { await sleep(200); if (await exec(sid, `return ${expr}`) === want) return true; } return false; }
const fail = (m) => { console.error('STARTREPEAT_FAIL:', m); process.exit(1); };
// which slide is shown in present: read the present title text
const presentTitle = (sid) => exec(sid, `const t=document.querySelector('.present-slide .el-text'); return t?t.textContent.trim():null;`);

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// (a) Select slide 2 in the editor, then present — present must show slide 2.
await exec(sid, "window.__eigendeck.store.getState().selectSlide(2);");
await sleep(200);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
if (!await waitFor(sid, "!!document.querySelector('.present-slide')")) fail('present did not mount');
await sleep(400);
const t = await presentTitle(sid);
if (!t || !/Slide Two Black/.test(t)) problems.push(`present started on '${t}', not the editor's current slide 2 ('Slide Two Black')`);
if (await exec(sid, "return window.__eigendeck.store.getState().currentSlideIndex") !== 2) problems.push(`csi != 2 at present start`);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
await waitFor(sid, "!!document.querySelector('.editor-area')");

// (b) 6 rapid present<->escape cycles from slide 1; assert no leak / drift.
await exec(sid, "window.__eigendeck.store.getState().selectSlide(1);");
await sleep(150);
for (let i = 0; i < 6; i++) {
  await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
  if (!await waitFor(sid, "!!document.querySelector('.present-slide')")) { problems.push(`cycle ${i}: present did not mount`); break; }
  await sleep(150);
  await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
  if (!await waitFor(sid, "!!document.querySelector('.editor-area .editor-actions')")) { problems.push(`cycle ${i}: editor did not remount`); break; }
  await sleep(150);
}
const after = await exec(sid, `return {
  presentNodes: document.querySelectorAll('.present-mode, .present-slide').length,
  bodyPresenting: document.body.classList.contains('presenting'),
  csi: window.__eigendeck.store.getState().currentSlideIndex,
  isPresenting: window.__eigendeck.store.getState().isPresenting,
};`);
if (after.presentNodes !== 0) problems.push(`after 6 cycles: ${after.presentNodes} leftover present DOM node(s)`);
if (after.bodyPresenting) problems.push(`after 6 cycles: body still .presenting`);
if (after.isPresenting) problems.push(`after 6 cycles: store.isPresenting still true`);
if (after.csi !== 1) problems.push(`after 6 cycles: slide drifted to ${after.csi} (expected 1)`);

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('STARTREPEAT_PASS: present starts on current slide; 6 cycles leave no leak/drift');
process.exit(0);
