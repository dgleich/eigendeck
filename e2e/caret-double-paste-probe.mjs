// Regression: editing a text element (caret mode) + paste must NOT also create
// a new element on the canvas (the reported "double paste"). The root cause was
// window-level paste handlers guarding only on e.target, which WebKit can set to
// <body> for a keyboard paste while the caret is in a contentEditable. This
// probe reproduces THAT dispatch shape deterministically (paste event dispatched
// on document.body while the editable is focused) in the REAL WebKit engine —
// something jsdom can't do — and asserts the guard (eventInTextEditor, which
// consults document.activeElement) holds.
//
//   PROBE=e2e/caret-double-paste-probe.mjs E2E_DECK=<deck> bash e2e/run-probe.sh
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function post(p, b) { try { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t) } catch { return t } } catch { return null; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
const fail = m => { console.error('FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('open session');
let ok = false;
for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) { ok = true; break; } }
if (!ok) fail('seam never ready');
await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");

const count = async () => exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.length;");

// A paste event dispatched on document.body (the WebKit keyboard-paste target
// shape) carrying plain text. Returns after dispatch.
const bodyPaste = async (text) => exec(sid, `
  const dt = new DataTransfer();
  dt.setData('text/plain', ${JSON.stringify(text)});
  document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return true;
`);
const waitCount = async (want, tries = 20) => { for (let i = 0; i < tries; i++) { if ((await count()) === want) return want; await sleep(250); } return await count(); };

const base = await count();
if (base !== 1) fail(`fixture should have exactly 1 element, got ${base}`);

// --- CONTROL: NOT editing. A body-targeted paste with text creates a text box.
//     Proves the paste path is live headlessly and the guard below is specific. ---
await exec(sid, "window.__eigendeck.store.getState().selectObject({type:'slide'});");
await bodyPaste('control paste text');
let n = await waitCount(base + 1);
if (n !== base + 1) fail(`control: expected a new text element (${base + 1}), got ${n} — paste path not live?`);
console.log(`  control OK — canvas paste created a text element (${base} → ${n})`);
const afterControl = n;

// --- REGRESSION: enter edit mode on the ORIGINAL text element, then dispatch the
//     SAME body-targeted paste. The guard must bail → NO new element. ---
const editing = await exec(sid, `
  // Find the display wrapper of element t0 and double-click it to enter edit mode.
  const host = document.querySelector('[data-element-id="t0"]') || document.querySelector('.slide-element');
  if (!host) return { err: 'no element host' };
  // onDoubleClick lives on an inner wrapper; dispatch on the deepest descendant
  // so the event bubbles UP through that handler. Fire on a few candidates.
  const cands = [host.querySelector('div div') , host.querySelector('div'), host];
  let fired = 0;
  for (const c of cands) { if (c) { c.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true })); fired++; } }
  return { dispatched: fired };
`);
if (editing?.err) fail(`enter edit mode: ${editing.err}`);
// Wait for a focused contentEditable to appear (edit mode engaged + focused).
let ceFocused = false;
for (let i = 0; i < 20; i++) {
  ceFocused = await exec(sid, `
    const ae = document.activeElement;
    return !!(ae && ae.closest && ae.closest('[contenteditable="true"]'));
  `);
  if (ceFocused) break;
  await sleep(250);
}
if (!ceFocused) fail('could not enter edit mode (no focused contentEditable after dblclick)');
console.log('  entered edit mode — caret is in a focused contentEditable');

const beforeEdit = await count();
await bodyPaste('while editing text');
await sleep(1200); // give any (buggy) async element-creation time to land
const afterEdit = await count();
if (afterEdit !== beforeEdit) {
  fail(`REGRESSION: editing + body-target paste created ${afterEdit - beforeEdit} new element(s) — the double paste is back (count ${beforeEdit} → ${afterEdit})`);
}
console.log(`  regression OK — editing + body-target paste created NO new element (stayed ${afterEdit})`);

// Sanity: the control proved the path is live, so afterEdit==beforeEdit is the guard, not a dead path.
if (afterControl <= base) fail('internal check: control did not add an element');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
console.log('E2E_PASS: caret-double-paste (guard holds while editing)');
process.exit(0);
