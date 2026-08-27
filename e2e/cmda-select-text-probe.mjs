// Regression: Cmd/Ctrl+A while EDITING a text box must select all its text.
// fe3b3bd dropped the "Select All" menu's Cmd+A accelerator (to unbreak the toolbar
// inputs); contentEditable in the app's WebKit doesn't get the automatic select-all
// that inputs do, so Cmd+A in a text box selected nothing. The editor must do the
// select-all explicitly. Uses NATIVE WebDriver pointer/key actions (real focus).
import { openApp, waitSeam, exec, post, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('CMDA_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
const perform = (a) => post(`/session/${sid}/actions`, { actions: a });
const release = () => fetch('http://127.0.0.1:4444/session/' + sid + '/actions', { method: 'DELETE' }).catch(() => {});
const centerOf = (id) => exec(sid, `const n=document.querySelector('[data-element-id="${id}"]'); if(!n)return null; const r=n.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`);
async function dblclick(id) {
  const c = JSON.parse(await centerOf(id)); if (!c) fail('no center ' + id);
  await perform([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 10, x: c.x, y: c.y, origin: 'viewport' },
    { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }, { type: 'pause', duration: 30 },
    { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
  ] }]);
  await release();
}
const ceText = (id) => exec(sid, `const n=document.querySelector('[data-element-id="${id}"] [contenteditable="true"]'); return n? n.textContent : '__NOCE__';`);
const selText = () => exec(sid, "const s=window.getSelection(); return s? s.toString() : '';");

// Enter edit on t1. startEditing() selects-all-then-collapses, so the caret starts
// at the end with NOTHING selected — a clean baseline for the Cmd+A test.
await dblclick('t1');
for (let i = 0; i < 25; i++) { await sleep(100); if (await exec(sid, `return !!document.querySelector('[data-element-id="t1"] [contenteditable="true"]')`)) break; }
const full = await ceText('t1');
if (full === '__NOCE__' || !full.trim()) fail('t1 did not enter edit mode / has no text (' + JSON.stringify(full) + ')');

// Send Ctrl+A (native Linux select-all; the app treats metaKey||ctrlKey the same,
// so this exercises the same code path Cmd+A hits on macOS).
await perform([{ type: 'key', id: 'kbd', actions: [
  { type: 'keyDown', value: '' },   // Control
  { type: 'keyDown', value: 'a' }, { type: 'keyUp', value: 'a' },
  { type: 'keyUp', value: '' },
] }]);
await release();
await sleep(150);

const sel = await selText();
await quit(sid);
if (sel.trim() !== full.trim()) {
  console.error(`CMDA_FAIL: Cmd/Ctrl+A selected ${JSON.stringify(sel)} but the box text is ${JSON.stringify(full)}`);
  process.exit(2);
}
console.log(`CMDA_PASS: Cmd/Ctrl+A selects all text in the editing box (${JSON.stringify(sel)})`);
process.exit(0);
