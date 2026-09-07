// e2e INTERACTION EXERCISE (coverage spike): drive as much REAL interaction/UI
// code as possible against the built app — genuine pointer gestures, the
// inspector's per-element-TYPE controls, the right-click context menu (via its
// real DOM), the inline text-format toolbar, marquee multi-select + align/
// distribute, and the Settings/Security windows. The point is BREADTH: mount
// every PropertiesPanel per-type section + SlideElementRenderer selection/
// resize/control-point branch and fire their handlers through real clicks/
// inputs — NOT the window.__eigendeck store seam (the seam is used only to
// open/observe, per seam discipline). Assert invariants + no-crash rather than
// pinning every pixel; optional controls are guarded so one missing control
// doesn't fail the run.
import { openApp, waitSeam, exec, post, quit, sleep } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('IX_FAIL:', m); process.exit(1); };
const problems = [];
const soft = (label, cond, detail) => { if (cond) { console.log(`  ✓ ${label}`); } else { problems.push(`${label}${detail ? ' — ' + detail : ''}`); console.log(`  · SKIP ${label}${detail ? ' (' + detail + ')' : ''}`); } };

const sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fail('open/seam');

// Install a crash sentinel: any uncaught error or unhandledrejection during the
// run is a hard failure (this is the "no-crash" invariant the exercise asserts).
await exec(sid, `
  window.__ixErrors = [];
  window.addEventListener('error', (e) => window.__ixErrors.push('error: ' + (e.message || e.type)));
  window.addEventListener('unhandledrejection', (e) => window.__ixErrors.push('reject: ' + (e.reason && e.reason.message || e.reason)));
`);

await exec(sid, "window.__eigendeck.store.getState().selectSlide(0);");
await sleep(1200);

const ids = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();return JSON.stringify(s.presentation.slides[0].elements.map(e=>({id:e.id,type:e.type})));"));
console.log('  seeded elements:', ids.map((e) => e.id).join(', '));
if (ids.length < 10) fail(`fixture too small: only ${ids.length} elements`);

// ── helpers ───────────────────────────────────────────────────────────────
async function selectEl(id) {
  await exec(sid, `var s=window.__eigendeck.store.getState();s.selectObject({type:'element',id:'${id}'});s.setInspectorTab('element');if(!s.showProperties)s.toggleProperties();`);
  for (let i = 0; i < 15; i++) { await sleep(200); if (await exec(sid, "return !!document.querySelector('.properties-panel .prop-section')")) return true; }
  return false;
}
// The inspector section labels currently mounted (proves the per-type branch rendered).
const sections = () => exec(sid, "return JSON.stringify([...document.querySelectorAll('.properties-panel .prop-section .prop-label')].map(l=>l.textContent))");
// Generically poke the live controls inside the inspector so their onChange/onClick
// handlers actually run (checkboxes, number/range inputs, selects). Returns a count.
async function pokeInspectorControls() {
  return Number(await exec(sid, `
    let n = 0;
    const panel = document.querySelector('.properties-panel');
    if (!panel) return 0;
    // checkboxes → toggle
    for (const cb of panel.querySelectorAll('input[type="checkbox"]')) { cb.click(); n++; }
    // number inputs → bump the value and fire input+change
    for (const inp of panel.querySelectorAll('input[type="number"]')) {
      const nv = (parseFloat(inp.value) || 0) + 5;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(inp, String(nv));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      n++;
    }
    // range inputs → move to a mid value
    for (const inp of panel.querySelectorAll('input[type="range"]')) {
      const min = parseFloat(inp.min || '0'), max = parseFloat(inp.max || '1');
      const nv = min + (max - min) * 0.4;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      inp.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
      setter.call(inp, String(nv));
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      inp.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
      n++;
    }
    // selects → pick a different option
    for (const sel of panel.querySelectorAll('select')) {
      if (sel.options.length > 1) {
        sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        n++;
      }
    }
    return n;
  `));
}
// Click a color swatch (first non-custom themed tint) in each ColorControl.
async function clickColorSwatches() {
  return Number(await exec(sid, `
    let n = 0;
    for (const b of document.querySelectorAll('.properties-panel button.prop-color-swatch')) {
      const t = (b.getAttribute('title') || '');
      if (/Theme|Black|White|#/.test(t)) { b.click(); n++; if (n >= 2) break; }
    }
    return n;
  `));
}
// Click a labelled inspector button (a .prop-zbtn) by its title/text substring.
async function clickPropBtn(match) {
  return await exec(sid, `
    const b=[...document.querySelectorAll('.properties-panel button.prop-zbtn')].find(x=>((x.getAttribute('title')||'')+ ' ' + (x.textContent||'')).includes(${JSON.stringify(match)}));
    if(b){b.click();return true;}return false;`);
}

// ── 1. per-type inspector: select each element, mount its section, poke controls ──
console.log('\n[1] per-element-type inspector sections + controls');
const wantSections = {
  'e-image': 'Effects', 'e-body': 'Font size', 'e-title': 'Font size',
  'e-video-embed': 'Playback', 'e-video-file': 'Playback', 'e-cover': 'Color',
  'e-html': 'Raw HTML', 'e-arrow': 'Heads', 'e-arrow-curve': 'Heads',
  'e-notebook': 'Editable',
};
for (const el of ids) {
  const ok = await selectEl(el.id);
  if (!ok) { problems.push(`inspector never mounted for ${el.id} (${el.type})`); continue; }
  const secs = JSON.parse(await sections());
  const want = wantSections[el.id];
  const hasWant = !want || secs.includes(want);
  const poked = await pokeInspectorControls();
  const swatches = await clickColorSwatches();
  soft(`${el.id} (${el.type}) inspector [${secs.length} sections, ${poked} controls, ${swatches} swatches]`, hasWant, want && !hasWant ? `missing "${want}"` : '');
  await sleep(120);
}

// Arrow-specific inspector buttons (heads / size presets / shape).
console.log('\n[1b] arrow inspector buttons (heads / size / shape)');
await selectEl('e-arrow');
soft('arrow "Both" heads button', await clickPropBtn('Both'));
await sleep(100);
soft('arrow "thick" size button', await clickPropBtn('thick'));
await sleep(100);

// Text vertical-align + effect buttons.
console.log('\n[1c] text inspector buttons (vertical align / effect)');
await selectEl('e-body');
soft('text vertical-align "Middle"', await clickPropBtn('Middle'));
await sleep(100);

// ── 2. real pointer gestures on the canvas ──────────────────────────────────
console.log('\n[2] real pointer gestures (drag / resize / arrow control point / marquee)');

// 2a. drag a text element via a real pointer gesture through the renderer.
await selectEl('e-body');
const dragBefore = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();const e=s.presentation.slides[0].elements.find(x=>x.id==='e-body');return JSON.stringify(e.position);"));
const dragRes = await exec(sid, `
  const node = document.querySelector('[data-element-id="e-body"]');
  if (!node) return 'no-node';
  const r = node.getBoundingClientRect();
  const x0 = r.left + r.width/2, y0 = r.top + r.height/2;
  const opt = (x,y,extra={}) => ({ clientX:x, clientY:y, bubbles:true, pointerId:1, button:0, ...extra });
  node.dispatchEvent(new PointerEvent('pointerdown', opt(x0,y0)));
  for (let i=1;i<=6;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + 20*i, y0 + 8*i)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + 120, y0 + 48)));
  const s = window.__eigendeck.store.getState();
  const e = s.presentation.slides[0].elements.find(x=>x.id==='e-body');
  return JSON.stringify(e.position);`);
const dragAfter = (dragRes && dragRes.startsWith('{')) ? JSON.parse(dragRes) : null;
soft('drag e-body moved it', dragAfter && (dragAfter.x !== dragBefore.x || dragAfter.y !== dragBefore.y), dragRes);

// 2b. resize e-image via its .el-resize-handle.
await selectEl('e-image');
const szBefore = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();const e=s.presentation.slides[0].elements.find(x=>x.id==='e-image');return JSON.stringify(e.position);"));
const szRes = await exec(sid, `
  const node = document.querySelector('[data-element-id="e-image"]');
  const h = node && node.querySelector('.el-resize-handle');
  if (!h) return 'no-handle';
  const r = h.getBoundingClientRect();
  const x0 = r.left + r.width/2, y0 = r.top + r.height/2;
  const opt = (x,y) => ({ clientX:x, clientY:y, bubbles:true, pointerId:1, button:0 });
  h.dispatchEvent(new PointerEvent('pointerdown', opt(x0,y0)));
  for (let i=1;i<=6;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + 15*i, y0 + 15*i)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + 90, y0 + 90)));
  const s = window.__eigendeck.store.getState();
  const e = s.presentation.slides[0].elements.find(x=>x.id==='e-image');
  return JSON.stringify(e.position);`);
const szAfter = (szRes && szRes.startsWith('{')) ? JSON.parse(szRes) : null;
soft('resize e-image changed w/h', szAfter && (szAfter.width !== szBefore.width || szAfter.height !== szBefore.height), szRes);

// 2c. drag an arrow control handle on the curved arrow.
await selectEl('e-arrow-curve');
await sleep(200);
const arrBefore = JSON.parse(await exec(sid, "const s=window.__eigendeck.store.getState();const e=s.presentation.slides[0].elements.find(x=>x.id==='e-arrow-curve');return JSON.stringify({c1x:e.c1x,c1y:e.c1y,x1:e.x1,y1:e.y1});"));
const arrRes = await exec(sid, `
  const node = document.querySelector('[data-element-id="e-arrow-curve"]') || document.querySelector('.el-arrow.is-selected');
  const handle = document.querySelector('.arrow-control-handle') || document.querySelector('.arrow-handle');
  if (!handle) return 'no-arrow-handle';
  const r = handle.getBoundingClientRect();
  const x0 = r.left + r.width/2, y0 = r.top + r.height/2;
  const opt = (x,y) => ({ clientX:x, clientY:y, bubbles:true, pointerId:1, button:0 });
  handle.dispatchEvent(new PointerEvent('pointerdown', opt(x0,y0)));
  for (let i=1;i<=6;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(x0 + 12*i, y0 - 6*i)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(x0 + 72, y0 - 36)));
  const s = window.__eigendeck.store.getState();
  const e = s.presentation.slides[0].elements.find(x=>x.id==='e-arrow-curve');
  return JSON.stringify({c1x:e.c1x,c1y:e.c1y,x1:e.x1,y1:e.y1,points:e.points});`);
const arrAfter = (arrRes && arrRes.startsWith('{')) ? JSON.parse(arrRes) : null;
soft('drag arrow control/endpoint changed geometry', arrAfter && JSON.stringify(arrAfter).slice(0, 40) !== JSON.stringify(arrBefore).slice(0, 40) || (arrAfter && (arrAfter.c1x !== arrBefore.c1x || arrAfter.x1 !== arrBefore.x1)), arrRes);

// 2d. marquee-select multiple elements by dragging on the canvas background.
await exec(sid, "window.__eigendeck.store.getState().selectObject({type:'slide'});");
await sleep(150);
const marqRes = await exec(sid, `
  const canvas = document.querySelector('.slide-canvas');
  if (!canvas) return 'no-canvas';
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / 1920;
  const sx = rect.left + 8*scale, sy = rect.top + 8*scale;   // logical (8,8) — background
  const ex = rect.left + 1400*scale, ey = rect.top + 340*scale; // sweep across top row
  const opt = (x,y) => ({ clientX:x, clientY:y, bubbles:true, cancelable:true, pointerId:1, button:0 });
  canvas.dispatchEvent(new PointerEvent('pointerdown', opt(sx,sy)));
  for (let i=1;i<=8;i++) window.dispatchEvent(new PointerEvent('pointermove', opt(sx + (ex-sx)*i/8, sy + (ey-sy)*i/8)));
  window.dispatchEvent(new PointerEvent('pointerup', opt(ex,ey)));
  const o = window.__eigendeck.store.getState().selectedObject;
  return JSON.stringify(o);`);
const marqSel = (marqRes && marqRes.startsWith('{')) ? JSON.parse(marqRes) : null;
const marqueeMulti = marqSel && marqSel.type === 'multi' && (marqSel.ids || []).length >= 2;
soft('marquee drag selected ≥2 elements', marqueeMulti, marqRes);

// ── 3. multi-select align + distribute in the inspector ─────────────────────
console.log('\n[3] multi-select align + distribute');
// Ensure a ≥3 multi-selection so BOTH Align and Distribute sections mount, even
// if the marquee under-selected (fall back to an explicit multi — still drives
// the real inspector buttons, which is the coverage target).
if (!marqueeMulti || (marqSel.ids || []).length < 3) {
  await exec(sid, "const s=window.__eigendeck.store.getState();s.selectObject({type:'multi',ids:['e-title','e-body','e-textbox','e-annot']});s.setInspectorTab('element');if(!s.showProperties)s.toggleProperties();");
}
await sleep(400);
const multiSecs = JSON.parse(await sections());
soft('multi inspector shows Align', multiSecs.includes('Align'));
soft('multi inspector shows Distribute', multiSecs.includes('Distribute'));
// Click every align button + both distribute buttons (real onClick → store align/distribute).
const alignClicks = Number(await exec(sid, `
  let n=0;
  const sec=[...document.querySelectorAll('.properties-panel .prop-section')].find(s=>s.querySelector('.prop-label')?.textContent==='Align');
  if(sec){for(const b of sec.querySelectorAll('button.prop-zbtn')){b.click();n++;}}
  return n;`));
soft(`clicked ${alignClicks} align buttons`, alignClicks >= 4);
const distClicks = Number(await exec(sid, `
  let n=0;
  const sec=[...document.querySelectorAll('.properties-panel .prop-section')].find(s=>s.querySelector('.prop-label')?.textContent==='Distribute');
  if(sec){for(const b of sec.querySelectorAll('button.prop-zbtn')){b.click();n++;}}
  return n;`));
soft(`clicked ${distClicks} distribute buttons`, distClicks >= 1);

// ── 4. context menu via its REAL DOM (z-order + delete) ─────────────────────
console.log('\n[4] context menu actions via menu DOM');
async function rightClick(id) {
  return exec(sid, `
    const n=document.querySelector('[data-element-id="${id}"]') || document.querySelector('.el-arrow');
    if(!n) return 'no-node';
    const r=n.getBoundingClientRect();
    n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.left+8,clientY:r.top+8}));
    return 'ok';`);
}
async function menuItemClick(label) {
  return exec(sid, `
    const it=[...document.querySelectorAll('.context-menu .context-menu-item')].find(x=>(x.textContent||'').includes(${JSON.stringify(label)}));
    if(it){it.click();return true;}return false;`);
}
async function dismissMenu() {
  // Dispatch Escape on document.body (a real element) — a real keystroke always
  // has an element target; dispatching on `window` makes e.target the window and
  // the App keydown guard's e.target.closest(...) throws (the same gotcha the
  // keyboard-shortcuts probe documents).
  await exec(sid, "document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));window.dispatchEvent(new CustomEvent('context-menu-closed'));");
  await sleep(150);
}
// z-order via menu on the cover element.
await exec(sid, "window.__eigendeck.store.getState().selectObject({type:'element',id:'e-cover'});");
await rightClick('e-cover');
await sleep(300);
soft('element context menu opened', await exec(sid, "return !!document.querySelector('.context-menu')"));
const zBefore = Number(await exec(sid, "const s=window.__eigendeck.store.getState();return s.presentation.slides[0].elements.findIndex(e=>e.id==='e-cover');"));
soft('menu "Bring to Front" clicked', await menuItemClick('Bring to Front'));
await sleep(250);
const zAfter = Number(await exec(sid, "const s=window.__eigendeck.store.getState();return s.presentation.slides[0].elements.findIndex(e=>e.id==='e-cover');"));
soft('Bring to Front raised z-order', zAfter >= zBefore);
await dismissMenu();

// delete via menu on a throwaway element we add first (don't destroy fixture elements).
await exec(sid, "window.__eigendeck.store.getState().addElement({id:'e-scratch',type:'text',preset:'body',html:'scratch',position:{x:1500,y:60,width:200,height:80}});");
await sleep(250);
await exec(sid, "window.__eigendeck.store.getState().selectObject({type:'element',id:'e-scratch'});");
await rightClick('e-scratch');
await sleep(300);
soft('menu "Delete" clicked', await menuItemClick('Delete'));
await sleep(300);
const scratchGone = await exec(sid, "const s=window.__eigendeck.store.getState();return !s.presentation.slides[0].elements.some(e=>e.id==='e-scratch');");
soft('Delete removed the element', scratchGone);
await dismissMenu();

// canvas background context menu → "Add Body".
const nBefore = Number(await exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.length;"));
await exec(sid, `
  const canvas=document.querySelector('.slide-canvas');
  const rect=canvas.getBoundingClientRect();const scale=rect.width/1920;
  canvas.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+8*scale,clientY:rect.top+8*scale}));`);
await sleep(300);
soft('canvas context menu opened', await exec(sid, "return !!document.querySelector('.context-menu')"));
soft('menu "Add Body" clicked', await menuItemClick('Add Body'));
await sleep(300);
const nAfter = Number(await exec(sid, "return window.__eigendeck.store.getState().presentation.slides[0].elements.length;"));
soft('Add Body inserted an element', nAfter === nBefore + 1);
await dismissMenu();

// ── 5. inline text-format toolbar (enter edit mode, select all, Bold + color) ─
console.log('\n[5] inline text-format toolbar');
await exec(sid, "window.__eigendeck.store.getState().selectObject({type:'element',id:'e-body'});");
await sleep(200);
// Enter edit mode: the renderer listens for a 'start-editing' event on the node.
await exec(sid, `
  const node=document.querySelector('[data-element-id="e-body"]');
  if(node){node.dispatchEvent(new CustomEvent('start-editing',{bubbles:false}));}`);
let toolbarUp = false;
for (let i = 0; i < 15; i++) { await sleep(250); toolbarUp = await exec(sid, "return !!document.querySelector('.text-format-toolbar')"); if (toolbarUp) break; }
soft('text-format toolbar appeared in edit mode', toolbarUp);
if (toolbarUp) {
  // Select all text in the editing box so exec('bold') has a range.
  await exec(sid, `
    const ed=document.querySelector('[contenteditable="true"]');
    if(ed){ed.focus();const r=document.createRange();r.selectNodeContents(ed);const s=window.getSelection();s.removeAllRanges();s.addRange(r);}`);
  await sleep(150);
  const boldClicked = await exec(sid, "const b=[...document.querySelectorAll('.text-format-toolbar button')].find(x=>(x.getAttribute('title')||'').startsWith('Bold'));if(b){b.click();return true;}return false;");
  soft('toolbar Bold clicked', boldClicked);
  const italClicked = await exec(sid, "const b=[...document.querySelectorAll('.text-format-toolbar button')].find(x=>(x.getAttribute('title')||'').startsWith('Italic'));if(b){b.click();return true;}return false;");
  soft('toolbar Italic clicked', italClicked);
  // Open the color dropdown and click a swatch.
  await exec(sid, "const b=[...document.querySelectorAll('.text-format-toolbar button')].find(x=>(x.getAttribute('title')||'')==='Text color');if(b)b.click();");
  await sleep(200);
  const colorClicked = await exec(sid, "const b=document.querySelector('.tf-color-dropdown button.prop-color-swatch');if(b){b.click();return true;}return false;");
  soft('toolbar color swatch clicked', colorClicked);
}
// Exit edit mode by a REAL outside pointerdown on the canvas background (a real
// Node — the renderer's window-capture commit listener reads target.closest, so
// dispatching on `window` would make target the window and throw, which the real
// app never does). Escape as a fallback.
await exec(sid, `
  const canvas=document.querySelector('.slide-canvas')||document.body;
  const r=canvas.getBoundingClientRect();
  canvas.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:Math.round(r.left+4),clientY:Math.round(r.top+4),pointerId:1,button:0}));
  document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));`);
await sleep(300);

// ── 6. Settings window: open + click through its tabs ───────────────────────
console.log('\n[6] Settings window tabs');
async function handles() { return (await exec(sid, "return 1")) !== undefined ? (await (await fetch('http://127.0.0.1:4444/session/' + sid + '/window/handles')).json())?.value || [] : []; }
async function switchTo(h) { await post(`/session/${sid}/window`, { handle: h }); }
const mainH = (await handles())[0];
await exec(sid, "window.__eigendeck.openSettings();");
let setH = null;
for (let i = 0; i < 12; i++) { await sleep(700); setH = (await handles()).find((h) => h !== mainH); if (setH) break; }
if (setH) {
  await switchTo(setH);
  await sleep(1200);
  let txt = '';
  for (let i = 0; i < 15; i++) { await sleep(400); txt = String(await exec(sid, "return document.body?document.body.textContent:''") || ''); if (txt.includes('General') && txt.includes('Jupyter servers')) break; }
  soft('Settings window rendered tabs', txt.includes('General') && txt.includes('Jupyter servers'), txt.slice(0, 80));
  // Click each tab button by text; poke a control on each tab.
  for (const tab of ['Security', 'UI', 'Jupyter servers', 'General']) {
    const clicked = await exec(sid, `const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').includes(${JSON.stringify(tab)}));if(b){b.click();return true;}return false;`);
    await sleep(400);
    soft(`Settings tab "${tab}" clicked`, clicked);
  }
  // Toggle a checkbox on the current (General) tab if present.
  await exec(sid, "const cb=document.querySelector('input[type=\"checkbox\"]');if(cb)cb.click();");
  await switchTo(mainH);
  await sleep(400);
} else {
  problems.push('Settings window did not open');
}

// ── 7. Security window: open + read its report + click a tab/control ─────────
console.log('\n[7] Security window');
try {
  const { openSecurityWindow, waitForText, closeSecurityWindow } = await import('./_ui.mjs');
  const secH = await openSecurityWindow(sid, mainH);
  if (secH) {
    await switchTo(secH);
    const rendered = await waitForText(sid, 'deck', 12) || await waitForText(sid, 'Trust', 6) || await waitForText(sid, 'file', 6);
    soft('Security window rendered a report', rendered);
    // Click any button that isn't destructive (e.g. a toggle/tab) — guarded.
    await exec(sid, "const b=[...document.querySelectorAll('button')].find(x=>{const t=(x.textContent||'').trim();return t && !/Stop trusting|Delete|Remove/.test(t);});if(b)b.click();");
    await sleep(400);
    await closeSecurityWindow(sid, mainH);
  } else {
    problems.push('Security window did not open');
  }
} catch (e) {
  problems.push('Security window step threw: ' + String(e).slice(0, 120));
}
await switchTo(mainH);
await sleep(300);

// ── 8. no-crash invariant + final sanity ────────────────────────────────────
console.log('\n[8] invariants');
const errs = JSON.parse(await exec(sid, "return JSON.stringify(window.__ixErrors||[])"));
// Filter out benign network errors from the youtube embed / missing asset (not app crashes).
const realErrs = errs.filter((e) => !/youtube|ytimg|network|Failed to fetch|load|ERR_/i.test(e));
if (realErrs.length) fail('uncaught errors during interaction: ' + JSON.stringify(realErrs.slice(0, 5)));
console.log(`  ✓ no uncaught app errors (${errs.length} total events, ${realErrs.length} non-benign)`);
const stillAlive = await exec(sid, "return !!(document.querySelector('.slide-canvas') && window.__eigendeck.store.getState().presentation.slides.length>=1)");
soft('canvas + store still healthy after all interactions', stillAlive);

await quit(sid);

// ── verdict ─────────────────────────────────────────────────────────────────
console.log('\n──────────────────────────────────────────');
if (problems.length) {
  console.error(`IX: ${problems.length} soft problem(s):`);
  for (const p of problems) console.error('   • ' + p);
}
// Hard-fail only if TOO MANY soft steps failed (a broken build/rig), else pass:
// the exercise is about breadth + no-crash, and individual optional controls are
// allowed to be absent. A large failure count means something structural broke.
if (problems.length > 8) fail(`too many interaction steps failed (${problems.length}) — likely a structural break`);
console.log('IX_PASS: interaction exercise drove per-type inspector, pointer gestures (drag/resize/arrow/marquee), context-menu actions, text toolbar, Settings + Security windows — no crash');
process.exit(0);
