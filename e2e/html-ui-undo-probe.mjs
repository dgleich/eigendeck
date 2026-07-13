// #137 regression: undo/redo is captured for the REAL html-element edit UIs, not
// just a store-level updateElement (which html-undo-redo-probe already covers).
// Exercises (A) the Inspector's Raw HTML <textarea> (React controlled onChange) and
// (B) in-canvas contentEditable (double-click → edit the framed body → Lock). Each:
// the edit lands, a temporal snapshot is pushed, and the app's real Cmd+Z reverts it.
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b) { const r = await fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); const t = await r.text(); try { return JSON.parse(t); } catch { return t; } }
async function exec(sid, s) { return (await post(`/session/${sid}/execute/sync`, { script: s, args: [] }))?.value; }
async function open() { for (let i = 0; i < 12; i++) { const j = await post('/session', { capabilities: { alwaysMatch: { 'tauri:options': { application: APP, args: [DECK] } } } }); if (j?.value?.sessionId) return j.value.sessionId; await sleep(1000); } return null; }
async function waitSeam(sid) { for (let i = 0; i < 25; i++) { await sleep(800); if (await exec(sid, "return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)")) return true; } return false; }
const getHtml = (sid) => exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='raw').html");
const past = (sid) => exec(sid, "return window.__eigendeck.store.temporal.getState().pastStates.length");
const undo = (sid) => exec(sid, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,bubbles:true}));");
const fail = (m) => { console.error('HTML_UI_UNDO_FAIL:', m); process.exit(1); };
const problems = [];

const sid = await open(); if (!sid) fail('no session'); if (!await waitSeam(sid)) fail('no seam');
await sleep(900);
const orig = await getHtml(sid);

// (A) Inspector Raw HTML textarea.
await exec(sid, "const s=window.__eigendeck.store.getState(); s.selectObject({type:'element',id:'raw'}); s.setInspectorTab('element'); if(!s.showProperties) s.toggleProperties();");
for (let i = 0; i < 15; i++) { await sleep(300); if (await exec(sid, "return !!document.querySelector('.properties-panel textarea')")) break; }
const p0 = await past(sid);
await exec(sid, "const ta=document.querySelector('.properties-panel textarea');const set=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;set.call(ta,'<div>INSPECTOR-EDIT</div>');ta.dispatchEvent(new Event('input',{bubbles:true}));");
await sleep(500);
if (await getHtml(sid) !== '<div>INSPECTOR-EDIT</div>') problems.push('inspector edit did not update the element');
if (!((await past(sid)) > p0)) problems.push('inspector edit pushed no undo snapshot');
await sleep(400); await undo(sid); await sleep(500);
if (await getHtml(sid) !== orig) problems.push('Cmd+Z did not revert the inspector edit');

// (B) In-canvas contentEditable (double-click → edit → Lock).
const orig2 = await getHtml(sid);
await exec(sid, "document.querySelector('.el-html .demo-overlay').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));");
await sleep(500);
const pb0 = await past(sid);
await exec(sid, "const f=document.querySelector('.el-html iframe');f.contentDocument.body.insertAdjacentHTML('beforeend','<p>CE-EDIT</p>');");
await exec(sid, "window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));");  // finish: no Lock button — Esc/click-away commits
await sleep(500);
const bEdit = await getHtml(sid);
if (!(bEdit && bEdit.includes('CE-EDIT'))) problems.push('contentEditable edit did not commit to the element');
if (!((await past(sid)) > pb0)) problems.push('contentEditable edit pushed no undo snapshot');
await sleep(400); await undo(sid); await sleep(500);
if (await getHtml(sid) !== orig2) problems.push('Cmd+Z did not revert the contentEditable edit');

await fetch(`${BASE}/session/${sid}`, { method: 'DELETE' }).catch(() => {});
if (problems.length) { for (const p of problems) console.error('  •', p); fail(`${problems.length} problem(s)`); }
console.log('HTML_UI_UNDO_PASS: undo/redo captured for both the Inspector textarea and in-canvas contentEditable edits.');
process.exit(0);
