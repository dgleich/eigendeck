// Mid-text-edit → Present (via F5, the real shortcut) → Escape loses uncommitted
// typed text. Text commits to the store only on blur / outside-pointerdown / Escape /
// toolbar-close (commitAndClose reads contentEditable.innerHTML). There is NO commit
// on unmount. F5 (App.tsx keydown → startPresenting → setPresenting(true)) fires even
// when focus is in a contentEditable and does NOT commit first, and it fully UNMOUNTS
// the editor (App returns <PresentMode/>). So whatever the user typed but hasn't
// committed is gone. flushToSqlite() in the F5 handler flushes the STORE, but the
// pending text lives in the DOM, not the store — so it isn't saved either.
//
// Repro: open editing on t0, replace its contentEditable innerHTML with a marker
// (simulating typing), press F5, Escape, and assert the store element html contains
// the marker. It won't.
const BASE = process.env.E2E_BASE || 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const MARKER = 'UNCOMMITTED_EDIT_XYZ';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
async function waitFor(sid, expr, want = true) { for (let i = 0; i < 30; i++) { await sleep(200); if (await exec(sid, `return ${expr}`) === want) return true; } return false; }
const fail = (m) => { console.error('MIDEDIT_FAIL:', m); process.exit(1); };
const el0html = (sid) => exec(sid, "return (window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='t0')||{}).html");

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];

// Make sure we're on slide 0 with t0 present.
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
if (!await waitFor(sid, "!!document.querySelector('[data-element-id=\"t0\"]')")) fail('t0 not on canvas');
const origHtml = await el0html(sid);

// 1. Enter editing on t0 (the real path: dispatch the start-editing event the box uses).
await exec(sid, `const el=document.querySelector('[data-element-id="t0"]'); el.dispatchEvent(new CustomEvent('start-editing',{bubbles:false}));`);
// contentEditable appears async (setEditing -> re-render -> setTimeout sets innerHTML+focus)
if (!await waitFor(sid, "!!document.querySelector('[data-element-id=\"t0\"] [contenteditable=\"true\"]')")) fail('contentEditable did not open on t0');
await sleep(200);

// 2. Simulate typing: set the contentEditable innerHTML + fire input (as a keystroke would),
//    WITHOUT committing (no blur / outside click).
const typed = await exec(sid, `
  const ce=document.querySelector('[data-element-id="t0"] [contenteditable="true"]');
  if(!ce) return false;
  ce.focus();
  ce.innerHTML = '<div>${MARKER}</div>';
  ce.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'X'}));
  return ce.innerHTML.includes('${MARKER}');
`);
if (!typed) fail('could not simulate typing into contentEditable');
// sanity: store NOT yet updated (still original) — commit is deferred
const midHtml = await el0html(sid);
if (midHtml && midHtml.includes(MARKER)) fail('precondition: store already has the typed text (auto-commit on input?) — this probe assumes deferred commit');

// 3. Present. In real usage the F5 key OR the native "Present Mode" menu item
//    (both go App keydown/menu -> startPresenting -> setPresenting(true)) enter
//    present WITHOUT committing the focused contentEditable first (unlike the
//    toolbar BUTTON, whose pointerdown blurs+commits via the outside-click handler).
//    (The rig CAN drive the projector 2nd window — see present-projector-probe +
//    _ui.mjs handle helpers; the old "2nd window crashes WebKitWebDriver" belief is
//    disproven.) We deliberately use the single-window unmount here: it's the exact
//    same setPresenting(true) path the F5 fallback / "Present (single window)" menu
//    produce, and it's what strips the focused contentEditable — no 2nd window needed.
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
if (!await waitFor(sid, "!!document.querySelector('.present-slide, .speaker-mode')")) fail('did not enter present');
await sleep(400);
// 4. Escape back to editor.
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
if (!await waitFor(sid, "!!document.querySelector('.editor-area')")) fail('editor did not return');
await sleep(300);

// 5. The typed text should have survived (committed on the present transition). Assert.
const finalHtml = await el0html(sid);
if (!finalHtml || !finalHtml.includes(MARKER)) {
  problems.push(`OBSERVED: after mid-edit F5-present + escape, t0.html = ${JSON.stringify(finalHtml)} (typed "${MARKER}" LOST; reverted to original ${JSON.stringify(origHtml)}). EXPECTED: the in-progress edit is committed before present unmounts the editor.`);
}

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('MIDEDIT_PASS: uncommitted text survives F5-present (committed before editor unmount)');
process.exit(0);
