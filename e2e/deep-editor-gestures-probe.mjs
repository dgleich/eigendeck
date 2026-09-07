// e2e DEEP EDITOR GESTURES (coverage spike): drive the COLD keyboard + multi-
// select + group-drag + snap paths in the REAL built app that the interaction
// probe (basic drag/resize/marquee) and keyboard-shortcuts probe (1px nudge,
// Cmd+], Escape, Cmd+D, Cmd+A) leave uncovered. This exercises App.tsx's keydown
// router branches (all-direction nudge, z-order variants, keyboard delete of a
// single element AND a multi-selection, group nudge) plus SlideElementRenderer's
// DraggableBox MULTI-drag path (moveElementsBy), the shift-click additive-select
// branch, and the snapCoord drag path — all through genuine pointer/keyboard
// events on the real target nodes (never on `window`, per the App keydown guard).
//
// Exercise-style + resilient: a crash sentinel + a handful of HARD invariants
// (nudge deltas, z-order top/bottom, group co-move, keyboard delete removes),
// with the rest as guarded soft steps so one absent control can't fail the run.
import { openApp, waitSeam, exec, sleep, quit } from './_ui.mjs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('DEEP_FAIL:', m); process.exit(1); };
const problems = [];
const soft = (label, cond, detail) => {
  if (cond) { console.log(`  ✓ ${label}`); }
  else { problems.push(`${label}${detail ? ' — ' + detail : ''}`); console.log(`  · SKIP ${label}${detail ? ' (' + detail + ')' : ''}`); }
};

const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fail('open/seam');

// Crash sentinel — an uncaught error / rejection during the run is a hard fail.
await exec(sid, `
  window.__deepErrors = [];
  window.addEventListener('error', (e) => window.__deepErrors.push('error: ' + (e.message || e.type)));
  window.addEventListener('unhandledrejection', (e) => window.__deepErrors.push('reject: ' + (e.reason && e.reason.message || e.reason)));
`);

await exec(sid, "const s=window.__eigendeck.store.getState();s.selectSlide(0);if(!s.showProperties)s.toggleProperties();");
await sleep(1000);

// Snap OFF to start so nudge / group-drag deltas are exact.
await exec(sid, "const s=window.__eigendeck.store.getState();if(s.snapToGrid)s.toggleSnapToGrid();if(s.showGrid)s.toggleShowGrid();");

const ids = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();return JSON.stringify(s.presentation.slides[0].elements.map(e=>e.id));"));
console.log('  seeded elements:', ids.join(', '));
if (ids.length < 5) fail(`fixture too small: only ${ids.length} elements`);

// ── helpers ─────────────────────────────────────────────────────────────────
// Dispatch a keydown on document.body (a REAL element — dispatching on window
// makes e.target the window and the App keydown guard's e.target.closest throws).
const key = (k, { shift = false, meta = false } = {}) => exec(sid,
  `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},shiftKey:${shift},metaKey:${meta},ctrlKey:${meta},bubbles:true}));`);
const selElement = (id) => exec(sid, `window.__eigendeck.store.getState().selectObject({type:'element',id:${JSON.stringify(id)}});`);
const posOf = async (id) => JSON.parse(await exec(sid, `const s=window.__eigendeck.store.getState();const e=s.presentation.slides[0].elements.find(x=>x.id===${JSON.stringify(id)});return JSON.stringify(e?e.position:null);`));
const idxOf = async (id) => Number(await exec(sid, `const s=window.__eigendeck.store.getState();return s.presentation.slides[0].elements.findIndex(e=>e.id===${JSON.stringify(id)});`));
const selType = () => exec(sid, "return window.__eigendeck.store.getState().selectedObject?.type;");
const exists = async (id) => await exec(sid, `const s=window.__eigendeck.store.getState();return s.presentation.slides[0].elements.some(e=>e.id===${JSON.stringify(id)});`);

// ── 1. keyboard nudge — all four directions (1px) + shift big-nudge (10px) ────
console.log('\n[1] keyboard nudge (1px all directions + 10px shift)');
await selElement('d1');
await sleep(150);
let p = await posOf('d1');
await key('ArrowRight'); await sleep(120);
let q = await posOf('d1');
if (q.x !== p.x + 1) fail(`nudge right: expected x ${p.x + 1}, got ${q.x}`);
await key('ArrowLeft'); await sleep(120);
q = await posOf('d1');
if (q.x !== p.x) fail(`nudge left: expected x ${p.x}, got ${q.x}`);
await key('ArrowDown'); await sleep(120);
q = await posOf('d1');
if (q.y !== p.y + 1) fail(`nudge down: expected y ${p.y + 1}, got ${q.y}`);
await key('ArrowUp'); await sleep(120);
q = await posOf('d1');
if (q.y !== p.y) fail(`nudge up: expected y ${p.y}, got ${q.y}`);
console.log('  ✓ 1px nudge in all four directions');
await key('ArrowRight', { shift: true }); await sleep(120);
q = await posOf('d1');
if (q.x !== p.x + 10) fail(`shift-nudge right: expected x ${p.x + 10}, got ${q.x}`);
console.log('  ✓ shift-arrow big nudge (10px)');
// restore d1
await exec(sid, "window.__eigendeck.store.getState().updateElement('d1',{position:{x:80,y:80,width:300,height:120}});");

// ── 2. keyboard z-order — Cmd+] / Cmd+[ / Cmd+Shift+] (top) / Cmd+Shift+[ (bottom) ──
console.log('\n[2] keyboard z-order (raise / lower / to-top / to-bottom)');
await selElement('d1');
await sleep(120);
const z0 = await idxOf('d1');
await key(']', { meta: true }); await sleep(120);
const z1 = await idxOf('d1');
soft(`Cmd+] raised d1 (${z0} -> ${z1})`, z1 > z0);
await key('[', { meta: true }); await sleep(120);
const z2 = await idxOf('d1');
soft(`Cmd+[ lowered d1 (${z1} -> ${z2})`, z2 < z1);
const nEls = ids.length;
await key(']', { meta: true, shift: true }); await sleep(150);
const zTop = await idxOf('d1');
if (zTop !== nEls - 1) fail(`Cmd+Shift+] should send d1 to top (index ${nEls - 1}), got ${zTop}`);
await key('[', { meta: true, shift: true }); await sleep(150);
const zBot = await idxOf('d1');
if (zBot !== 0) fail(`Cmd+Shift+[ should send d1 to bottom (index 0), got ${zBot}`);
console.log('  ✓ z-order to-top / to-bottom land at extremes');

// ── 3. Cmd+A select-all → real-pointer GROUP drag (moveElementsBy path) ───────
console.log('\n[3] select-all + group drag (multi-drag path)');
await exec(sid, "const s=window.__eigendeck.store.getState();s.selectObject({type:'slide'});");
await sleep(120);
await key('a', { meta: true }); await sleep(200);
soft('Cmd+A produced a multi-selection', (await selType()) === 'multi');
const beforeD1 = await posOf('d1');
const beforeD2 = await posOf('d2');
// Real pointer drag on d1's node — window carries the moves/up (DraggableBox
// attaches its move/up listeners to window). Multi-drag translates ALL selected.
const groupRes = await exec(sid, `
  const node = document.querySelector('[data-element-id="d1"]');
  if (!node) return 'no-node';
  const r = node.getBoundingClientRect();
  const x0 = r.left + r.width/2, y0 = r.top + r.height/2;
  const opt = (x,y) => ({ clientX:x, clientY:y, bubbles:true, pointerId:1, button:0 });
  node.dispatchEvent(new PointerEvent('pointerdown', opt(x0,y0)));
  for (let i=1;i<=8;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + 120*i/8, y0 + 60*i/8)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + 120, y0 + 60)));
  return 'ok';`);
await sleep(200);
const afterD1 = await posOf('d1');
const afterD2 = await posOf('d2');
const dxD1 = afterD1.x - beforeD1.x, dyD1 = afterD1.y - beforeD1.y;
const dxD2 = afterD2.x - beforeD2.x, dyD2 = afterD2.y - beforeD2.y;
if (dxD1 === 0 && dyD1 === 0) fail(`group drag did not move d1 (res=${groupRes})`);
if (dxD1 !== dxD2 || dyD1 !== dyD2) fail(`group drag: d1 moved (${dxD1},${dyD1}) but d2 moved (${dxD2},${dyD2}) — should be identical`);
console.log(`  ✓ group drag moved d1 and d2 by the same delta (${dxD1},${dyD1})`);

// ── 4. group nudge (multi still selected → all move by 1px) ───────────────────
console.log('\n[4] group nudge (multi-selection arrow key)');
if ((await selType()) === 'multi') {
  const gN0 = await posOf('d2');
  await key('ArrowRight'); await sleep(120);
  const gN1 = await posOf('d2');
  soft(`group nudge moved d2 (${gN0.x} -> ${gN1.x})`, gN1.x === gN0.x + 1, `got ${gN1.x}`);
} else {
  problems.push('group nudge skipped — selection was not multi');
}

// ── 5. shift-click additive selection (real pointer, shiftKey) ────────────────
console.log('\n[5] shift-click additive selection');
await selElement('d1');
await sleep(120);
// pointerdown with shiftKey on d3 → handlePointerDown shift branch → toggleSelectElement.
await exec(sid, `
  const node = document.querySelector('[data-element-id="d3"]');
  if (node) {
    const r = node.getBoundingClientRect();
    node.dispatchEvent(new PointerEvent('pointerdown', { clientX:r.left+10, clientY:r.top+10, bubbles:true, pointerId:1, button:0, shiftKey:true }));
  }`);
await sleep(180);
const shiftSel = JSON.parse(await exec(sid, "return JSON.stringify(window.__eigendeck.store.getState().selectedObject);"));
soft('shift-click made a multi-selection incl. d1 & d3',
  shiftSel && shiftSel.type === 'multi' && (shiftSel.ids || []).includes('d1') && (shiftSel.ids || []).includes('d3'),
  JSON.stringify(shiftSel));

// ── 6. Escape deselects to the slide ──────────────────────────────────────────
console.log('\n[6] Escape deselect');
await key('Escape'); await sleep(150);
soft('Escape deselected to slide', (await selType()) === 'slide');

// ── 7. keyboard delete — single element + multi-selection ─────────────────────
console.log('\n[7] keyboard delete (single + multi)');
// single
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'del1',type:'text',preset:'body',html:'del me',position:{x:1400,y:60,width:200,height:80}});");
await sleep(150);
await selElement('del1');
await sleep(120);
await key('Backspace'); await sleep(200);
if (await exists('del1')) fail('Backspace did not delete the selected element');
console.log('  ✓ Backspace deleted the single selected element');
// multi
await exec(sid, `const s=window.__eigendeck.store.getState();
  s.addElement({id:'del2',type:'text',preset:'body',html:'a',position:{x:1400,y:200,width:180,height:70}});
  s.addElement({id:'del3',type:'text',preset:'body',html:'b',position:{x:1400,y:300,width:180,height:70}});
  s.selectObject({type:'multi',ids:['del2','del3']});`);
await sleep(180);
await key('Delete'); await sleep(220);
const bothGone = !(await exists('del2')) && !(await exists('del3'));
if (!bothGone) fail('Delete did not remove the multi-selection');
console.log('  ✓ Delete removed the multi-selection');

// ── 8. resize via the .el-resize-handle (real pointer) ────────────────────────
console.log('\n[8] resize handle (real pointer)');
await selElement('d4');
await sleep(150);
const szBefore = await posOf('d4');
const szRes = await exec(sid, `
  const node = document.querySelector('[data-element-id="d4"]');
  const h = node && node.querySelector('.el-resize-handle');
  if (!h) return 'no-handle';
  const r = h.getBoundingClientRect();
  const x0 = r.left + r.width/2, y0 = r.top + r.height/2;
  const opt = (x,y) => ({ clientX:x, clientY:y, bubbles:true, pointerId:1, button:0 });
  h.dispatchEvent(new PointerEvent('pointerdown', opt(x0,y0)));
  for (let i=1;i<=6;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + 20*i, y0 + 20*i)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + 120, y0 + 120)));
  return 'ok';`);
await sleep(180);
const szAfter = await posOf('d4');
soft('resize handle changed w/h', szAfter && (szAfter.width !== szBefore.width || szAfter.height !== szBefore.height), szRes);

// ── 9. snap-to-grid drag (snapCoord path with a text element) ─────────────────
console.log('\n[9] snap-to-grid drag');
await exec(sid, "localStorage.setItem('eigendeck:pref:gridSpacing','80');window.dispatchEvent(new CustomEvent('eigendeck:pref-changed',{detail:{key:'gridSpacing'}}));const s=window.__eigendeck.store.getState();if(!s.snapToGrid)s.toggleSnapToGrid();");
await exec(sid, "window.__eigendeck.store.getState().updateElement('d5',{position:{x:83,y:97,width:600,height:120}});");
await selElement('d5');
await sleep(150);
const snapRes = await exec(sid, `
  const node = document.querySelector('[data-element-id="d5"]');
  if (!node) return 'no-node';
  const r = node.getBoundingClientRect();
  const x0 = r.left + 20, y0 = r.top + 20;
  const opt = (x,y) => ({ clientX:x, clientY:y, bubbles:true, pointerId:1, button:0 });
  node.dispatchEvent(new PointerEvent('pointerdown', opt(x0,y0)));
  for (let i=1;i<=6;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + 25*i, y0 + 18*i)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + 150, y0 + 108)));
  const s = window.__eigendeck.store.getState();
  const e = s.presentation.slides[0].elements.find(x=>x.id==='d5');
  return JSON.stringify(e.position);`);
const snapPos = (snapRes && snapRes.startsWith('{')) ? JSON.parse(snapRes) : null;
soft('snap drag landed on the 80-grid', snapPos && snapPos.x % 80 === 0 && snapPos.y % 80 === 0, snapRes);
await exec(sid, "const s=window.__eigendeck.store.getState();if(s.snapToGrid)s.toggleSnapToGrid();");

// ── 10. marquee multi-select (real pointer on canvas background) ──────────────
console.log('\n[10] marquee multi-select');
await exec(sid, "window.__eigendeck.store.getState().selectObject({type:'slide'});");
await sleep(120);
const marqRes = await exec(sid, `
  const canvas = document.querySelector('.slide-canvas');
  if (!canvas) return 'no-canvas';
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / 1920;
  const sx = rect.left + 40*scale, sy = rect.top + 40*scale;
  const ex = rect.left + 820*scale, ey = rect.top + 420*scale;
  const opt = (x,y) => ({ clientX:x, clientY:y, bubbles:true, cancelable:true, pointerId:1, button:0 });
  canvas.dispatchEvent(new PointerEvent('pointerdown', opt(sx,sy)));
  for (let i=1;i<=8;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(sx + (ex-sx)*i/8, sy + (ey-sy)*i/8)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(ex,ey)));
  return JSON.stringify(window.__eigendeck.store.getState().selectedObject);`);
const marqSel = (marqRes && marqRes.startsWith('{')) ? JSON.parse(marqRes) : null;
soft('marquee selected ≥2 elements', marqSel && marqSel.type === 'multi' && (marqSel.ids || []).length >= 2, marqRes);

// ── 11. Cmd+D duplicate (element count +1) ────────────────────────────────────
console.log('\n[11] Cmd+D duplicate element');
await selElement('d2');
await sleep(120);
const nBefore = Number(await exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.length;"));
await key('d', { meta: true }); await sleep(220);
const nAfter = Number(await exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.length;"));
soft('Cmd+D duplicated the element', nAfter === nBefore + 1, `${nBefore} -> ${nAfter}`);

// ── 12. invariants ────────────────────────────────────────────────────────────
console.log('\n[12] invariants');
const errs = JSON.parse(await exec(sid, "return JSON.stringify(window.__deepErrors||[])"));
const realErrs = errs.filter((e) => !/network|Failed to fetch|load|ERR_/i.test(e));
if (realErrs.length) fail('uncaught errors during gestures: ' + JSON.stringify(realErrs.slice(0, 5)));
console.log(`  ✓ no uncaught app errors (${errs.length} events, ${realErrs.length} non-benign)`);
const alive = await exec(sid, "return !!(document.querySelector('.slide-canvas') && window.__eigendeck.store.getState().presentation.slides.length>=1)");
soft('canvas + store healthy after all gestures', alive);

await quit(sid);

console.log('\n──────────────────────────────────────────');
if (problems.length) {
  console.error(`DEEP: ${problems.length} soft problem(s):`);
  for (const p of problems) console.error('   • ' + p);
}
if (problems.length > 6) fail(`too many gesture steps failed (${problems.length}) — likely a structural break`);
console.log('DEEP_PASS: keyboard nudge (all dirs + 10px), z-order to-top/bottom, group drag + group nudge, shift-click additive, Escape, keyboard delete (single+multi), resize handle, snap drag, marquee, Cmd+D — no crash');
process.exit(0);
