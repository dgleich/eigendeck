// Bug: double-clicking a text box with vertical MIDDLE/BOTTOM alignment shifts the
// text visually, because the editing contentEditable omits the valign flex that the
// display SVG applies (text jumps to the TOP while editing). Measure the text's
// vertical offset within its box in DISPLAY vs EDIT mode; a large delta = the shift.
// TOP-aligned is the control (no shift either way).
import { openApp, waitSeam, exec, post, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('VALIGN_FAIL:', m); process.exit(1); };
const THRESH = 8;   // px of on-screen text drift we treat as a visible shift

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
// vertical offset (px) of the actual TEXT glyphs from the top of the element box.
// Uses a DOM Range over the text host so it works across the SVG-foreignObject
// (display) and contentEditable (edit) structures alike.
const textOffset = (id, hostSel) => exec(sid, `
  const box = document.querySelector('[data-element-id="${id}"]');
  const host = document.querySelector('[data-element-id="${id}"] ${hostSel}');
  if (!box || !host) return null;
  // Range over the FIRST TEXT NODE so we measure actual glyphs, not the wrapping
  // box/foreignObject (whose rect is the whole element box). Works in both the SVG
  // foreignObject (display) and the contentEditable (edit).
  const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let tn; do { tn = w.nextNode(); } while (tn && !tn.textContent.trim());
  if (!tn) return null;
  const r = document.createRange(); r.selectNode(tn);
  const t = r.getBoundingClientRect().top, b = box.getBoundingClientRect().top;
  return Math.round(t - b);
`);

const problems = [];
for (const [id, va, expectShift] of [['tmid','middle',false], ['tbot','bottom',false], ['ttop','top',false], ['ttitle','title/bottom',false]]) {
  const disp = await textOffset(id, 'foreignObject');
  if (disp == null) fail(`${id}: no display text host`);
  await dblclick(id);
  for (let i = 0; i < 25; i++) { await sleep(100); if (await exec(sid, `return !!document.querySelector('[data-element-id="${id}"] [contenteditable="true"]')`)) break; }
  const edit = await textOffset(id, '[contenteditable="true"]');
  if (edit == null) fail(`${id}: did not enter edit mode`);
  // commit out of edit before the next element (Escape)
  await perform([{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: '' }, { type: 'keyUp', value: '' }] }]); await release();
  await sleep(200);
  const shift = Math.abs(disp - edit);
  const verdict = shift <= THRESH ? 'ok' : 'SHIFT';
  console.log(`  ${id} (${va}): display=${disp}px edit=${edit}px  shift=${shift}px  ${verdict}`);
  if (shift > THRESH) problems.push(`${id} (${va}) shifts ${shift}px on edit`);
}
await quit(sid);
if (problems.length) { console.error('VALIGN_SHIFT: ' + problems.join('; ')); process.exit(2); }
console.log('VALIGN_PASS: no visible text shift entering edit for any vertical alignment');
process.exit(0);
