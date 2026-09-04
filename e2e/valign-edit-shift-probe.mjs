// Bug: a text box with vertical MIDDLE/BOTTOM alignment shifts its text on double-click
// to edit. Root cause (engine-independent, pure geometry): `.slide-element` has a 2px
// border with box-sizing:border-box, so the edit contentEditable valigns within the
// (h-4) content box, while DISPLAY injects an SVG hard-authored at w×h and valigns within
// the full h. Delta is border-width-only: top 0, middle +2, bottom +4 SLIDE px.
// See .claude/logs/2026-09-04-valign-edit-shift-session.md. Measured in SLIDE coordinates (viewport px /
// canvas scale) so the ~0.5 editor zoom doesn't hide it.
import { openApp, waitSeam, exec, post, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('VALIGN_FAIL:', m); process.exit(1); };
const ESC = String.fromCharCode(0xE00C);
const THRESH = 1;   // slide-px; the true post-fix delta is 0, pre-fix is 2 (middle) / 4 (bottom)

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
// glyph-top offset from the element box top, in SLIDE px (÷ canvas scale). Range over the
// first text node so it measures actual glyphs in either the SVG foreignObject or the CE.
const textOffset = (id, hostSel) => exec(sid, `
  const box = document.querySelector('[data-element-id="${id}"]');
  const host = document.querySelector('[data-element-id="${id}"] ${hostSel}');
  if (!box || !host) return null;
  const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let tn; do { tn = w.nextNode(); } while (tn && !tn.textContent.trim());
  if (!tn) return null;
  const r = document.createRange(); r.selectNode(tn);
  const br = box.getBoundingClientRect();
  const scale = br.width / box.offsetWidth || 1;     // viewport px per slide px
  return (r.getBoundingClientRect().top - br.top) / scale;
`);

const problems = [];
for (const [id, va] of [['ttop', 'top'], ['tmid', 'middle'], ['tbot', 'bottom'], ['ttitle', 'title/bottom']]) {
  const disp = await textOffset(id, 'foreignObject');
  if (disp == null) fail(`${id}: no display text host`);
  await dblclick(id);
  for (let i = 0; i < 25; i++) { await sleep(100); if (await exec(sid, `return !!document.querySelector('[data-element-id="${id}"] [contenteditable="true"]')`)) break; }
  const edit = await textOffset(id, '[contenteditable="true"]');
  if (edit == null) fail(`${id}: did not enter edit mode`);
  await perform([{ type: 'key', id: 'kbd', actions: [{ type: 'keyDown', value: ESC }, { type: 'keyUp', value: ESC }] }]); await release();
  await sleep(200);
  const delta = Math.abs(disp - edit);
  console.log(`  ${id} (${va}): display=${disp.toFixed(1)} edit=${edit.toFixed(1)}  delta=${delta.toFixed(1)} slide-px  ${delta <= THRESH ? 'ok' : 'SHIFT'}`);
  if (delta > THRESH) problems.push(`${id} (${va}) shifts ${delta.toFixed(1)} slide-px on edit`);
}
await quit(sid);
if (problems.length) { console.error('VALIGN_SHIFT: ' + problems.join('; ')); process.exit(2); }
console.log('VALIGN_PASS: text does not shift on edit for any vertical alignment (< 1 slide-px)');
process.exit(0);
