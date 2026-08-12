// #177 (CRITICAL, data loss): editing a text box (contentEditable, not yet
// committed) then triggering "New Slide" must KEEP the in-progress edit. The edit
// only lives in the DOM until a commit fires; New Slide moves currentSlideIndex
// first, then the old element unmounts and commits — which used to no-op on the
// new slide and drop the edit. Real WebKit needed (contentEditable + unmount).
import { openApp, waitSeam, exec, sleep, quit } from './_ui.mjs';
const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const fail = (m) => { console.error('TEXTEDIT_FAIL:', m); process.exit(1); };

const sid = await openApp(APP, DECK); if (!sid || !await waitSeam(sid)) fail('open/seam');
const htmlOf = () => exec(sid, `return (window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='t1')||{}).html || ''`);

if (!/ORIGINAL/.test(await htmlOf())) fail('fixture: t1 should start as ORIGINAL');

// Drive one scenario: enter edit → type (DOM only, no commit) → New Slide → assert kept.
async function scenario(name, triggerNewSlide) {
  // reset: make sure we're on slide 0 and t1 is ORIGINAL (fresh session per probe run,
  // but scenarios run in sequence so restore t1 + delete any added slide between them).
  await exec(sid, `const s=window.__eigendeck.store.getState(); s.selectSlide(0);`);
  await sleep(150);
  // enter edit mode
  await exec(sid, `document.querySelector('[data-element-id="t1"]').dispatchEvent(new CustomEvent('start-editing',{bubbles:false}))`);
  // wait for the contentEditable to appear + startEditing's setTimeout(0) to seed it
  let ce = false;
  for (let i = 0; i < 20; i++) { await sleep(100); if (await exec(sid, `return !!document.querySelector('[data-element-id="t1"] [contenteditable="true"]')`)) { ce = true; break; } }
  if (!ce) fail(`${name}: never entered edit mode (no contentEditable)`);
  await sleep(150);
  // "type" the edit into the contentEditable (DOM only — onInput does NOT commit)
  const marker = `EDITED_${name}`;
  await exec(sid, `const n=document.querySelector('[data-element-id="t1"] [contenteditable="true"]'); n.focus(); n.innerHTML='${marker}'; n.dispatchEvent(new InputEvent('input',{bubbles:true,data:'x',inputType:'insertText'}));`);
  await sleep(150);
  // sanity: store should still say ORIGINAL (edit not committed yet)
  const before = await htmlOf();
  if (/EDITED_/.test(before)) console.log(`  (note: ${name}: edit already committed pre-New-Slide: ${before})`);
  // trigger New Slide
  await triggerNewSlide();
  await sleep(500); // let React unmount + the commit-on-unmount fire
  // assert: the edit landed on slide 0's t1 (kept, not dropped)
  const after = await exec(sid, `return (window.__eigendeck.store.getState().presentation.slides[0].elements.find(e=>e.id==='t1')||{}).html || ''`);
  if (!after.includes(marker)) fail(`${name}: edit LOST — slide0 t1 html='${after}' (expected to contain '${marker}')`);
  console.log(`  ${name}: edit kept on slide 0 (t1 html contains ${marker}) ✓`);
  // cleanup: remove the slide we just added so the next scenario starts clean
  await exec(sid, `const s=window.__eigendeck.store.getState(); if(s.presentation.slides.length>1) s.deleteSlide(1); s.selectSlide(0);`);
  await sleep(150);
}

// A) keyboard/menu/programmatic New Slide (store action) — the deterministic unmount race
await scenario('STORE', () => exec(sid, `window.__eigendeck.store.getState().addSlide()`));
// B) the real "+ Add Slide" button with a full pointer sequence (David's exact action)
await scenario('BUTTON', () => exec(sid, `
  const b=document.querySelector('.btn-add-slide'); if(!b) throw new Error('no .btn-add-slide');
  const r=b.getBoundingClientRect(), x=r.x+r.width/2, y=r.y+r.height/2, o={bubbles:true,cancelable:true,clientX:x,clientY:y};
  b.dispatchEvent(new PointerEvent('pointerdown',o)); b.dispatchEvent(new PointerEvent('pointerup',o)); b.dispatchEvent(new MouseEvent('click',o));
`));

await quit(sid);
console.log('TEXTEDIT_PASS: in-progress text edit survives New Slide (store + button) (#177)');
process.exit(0);
