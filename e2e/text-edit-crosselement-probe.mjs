// Text edit lost when double-clicking STRAIGHT from one text element into another.
// While editing text A (contentEditable, uncommitted), double-clicking text B to
// edit it must (a) COMMIT A's in-progress edit and (b) let B be edited without
// dropping typing. Uses NATIVE WebDriver pointer/key actions (real focus/blur +
// real dblclick detail) — synthetic dispatchEvent does NOT reproduce it.
// Companion to #177 (New-Slide commit-after-change).
import { openApp, waitSeam, exec, post, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('XEDIT_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
const htmlOf = (id) => exec(sid, `return (window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='${id}')||{}).html || ''`);
const centerOf = (id) => exec(sid, `const n=document.querySelector('[data-element-id="${id}"]'); if(!n) return null; const r=n.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`);
const perform = (actions) => post(`/session/${sid}/actions`, { actions });
const release = () => fetch(`http://127.0.0.1:4444/session/${sid}/actions`, { method: 'DELETE' }).catch(() => {});

async function dblclick(id) {
  const c = JSON.parse(await centerOf(id)); if (!c) fail(`no center for ${id}`);
  await perform([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 10, x: c.x, y: c.y, origin: 'viewport' },
    { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 }, { type: 'pause', duration: 30 },
    { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
  ] }]);
  await release();
}
async function clickAt(x, y) {
  await perform([{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 10, x, y, origin: 'viewport' },
    { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
  ] }]);
  await release();
}
async function typeText(text) {
  const acts = [];
  for (const ch of text) { acts.push({ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch }); }
  await perform([{ type: 'key', id: 'kbd', actions: acts }]);
  await release();
}
const ceExists = (id) => exec(sid, `return !!document.querySelector('[data-element-id="${id}"] [contenteditable="true"]')`);
async function waitCE(id, on = true) { for (let i = 0; i < 25; i++) { await sleep(100); if ((await ceExists(id)) === on) return true; } return false; }

if (!/ORIGINAL_A/.test(await htmlOf('t1'))) fail('fixture: t1 should start ORIGINAL_A');
if (!/ORIGINAL_B/.test(await htmlOf('t2'))) fail('fixture: t2 should start ORIGINAL_B');

// 1) Native double-click t1 → enter edit; select-all is done by startEditing.
await dblclick('t1');
if (!await waitCE('t1')) fail('t1 never entered edit mode');
await sleep(200);
// Replace t1's content with a marker (select-all then type). startEditing already
// selected all children, so typing replaces.
await exec(sid, `const n=document.querySelector('[data-element-id="t1"] [contenteditable="true"]'); n.focus(); const s=window.getSelection(); s.selectAllChildren(n);`);
await typeText('EDITED_A_MATH');
await sleep(200);

// 2) Native double-click STRAIGHT into t2. Must commit t1 AND enter t2.
await dblclick('t2');
await sleep(300);
// t1 must have left edit and KEPT its content.
const t1 = await htmlOf('t1');
if (!t1.includes('EDITED_A_MATH')) fail(`t1 edit LOST when switching to t2 — t1 html='${t1}'`);
console.log(`  t1 edit kept after double-clicking into t2 ✓`);

// 3) t2 should now be editable; type a paragraph — it must NOT be discarded.
if (!await waitCE('t2')) fail('t2 never entered edit mode after double-click');
await exec(sid, `const n=document.querySelector('[data-element-id="t2"] [contenteditable="true"]'); n.focus(); const s=window.getSelection(); s.selectAllChildren(n);`);
await typeText('EDITED_B_PARA');
await sleep(200);
// Commit t2 by clicking empty canvas area.
await clickAt(30, 30);
await sleep(400);
const t2 = await htmlOf('t2');
if (!t2.includes('EDITED_B_PARA')) fail(`t2 typing DISCARDED — t2 html='${t2}'`);
console.log(`  t2 typing kept after entering from t1 ✓`);

await quit(sid);
console.log('XEDIT_PASS: text edits survive double-clicking between two text elements');
process.exit(0);
