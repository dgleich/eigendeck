// #137 raw-HTML element — UNDO/REDO of an html edit via the REAL keyboard path.
// Edit element.html (as the inspector would), then dispatch the app's real
// Cmd/Ctrl+Z (undoWithNav) and Cmd/Ctrl+Shift+Z (redoWithNav) keydowns that
// App.tsx listens for. Assert the html reverts on undo and comes back on redo,
// and the editor iframe srcdoc tracks it.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const NEW_HTML = '<div id="undoEIGEN">UNDO-EDIT-77</div>';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const getHtml = (sid) => exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='raw').html");
const fail = (m) => { console.error('HTML_UNDO_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
const problems = [];
await sleep(900);

const orig = await getHtml(sid);
if (!orig || !orig.includes('EIGEN')) problems.push(`unexpected original html: ${JSON.stringify((orig||'').slice(0,40))}`);

// Make an undoable edit. selectObject first so the undo entry is a clean
// element-content change (zundo snapshots the store).
await exec(sid, `
  const s = window.__eigendeck.store.getState();
  s.selectObject({ type: 'element', id: 'raw' });
  s.updateElement('raw', { html: ${JSON.stringify(NEW_HTML)} });
`);
await sleep(400);
if (await getHtml(sid) !== NEW_HTML) problems.push('edit did not apply');

// Real undo: the app binds Cmd/Ctrl+Z (no shift) to undoWithNav. Dispatch on
// document.body so `inEditable` is false (not inside a contentEditable).
await exec(sid, "document.body.focus(); document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,bubbles:true}));");
await sleep(500);
const afterUndo = await getHtml(sid);
if (afterUndo !== orig) problems.push(`undo did not revert html (got ${JSON.stringify((afterUndo||'').slice(0,40))})`);

// Real redo: Cmd/Ctrl+Shift+Z → redoWithNav.
await exec(sid, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,shiftKey:true,bubbles:true}));");
await sleep(500);
const afterRedo = await getHtml(sid);
if (afterRedo !== NEW_HTML) problems.push(`redo did not restore the edit (got ${JSON.stringify((afterRedo||'').slice(0,40))})`);
const srcdocOk = await exec(sid, "const f=document.querySelector('.el-html iframe'); return !!(f && (f.getAttribute('srcdoc')||'').includes('UNDO-EDIT-77'));");
if (!srcdocOk) problems.push('editor srcdoc did not track the redo');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('HTML_UNDO_PASS: real Cmd+Z reverted the html edit and Cmd+Shift+Z restored it (undoWithNav/redoWithNav), srcdoc tracked.');
process.exit(0);
