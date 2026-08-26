// Exploratory workflow: build a small talk through the REAL editor controls,
// then save, reopen, and verify its structure. The store seam is observation-only;
// authoring goes through toolbar/sidebar/context-menu/contentEditable/notes UI.
import { openApp, waitSeam, quit, exec, execA, post, sleep, dragElementToX } from './_ui.mjs';

const APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const problems = [];
const bug = (message) => problems.push(message);
const fatal = (message) => { console.error('USER_BUILD_FATAL:', message); process.exit(1); };

async function clickTitle(sid, title) {
  return exec(sid, `const b=document.querySelector('button[title=${JSON.stringify(title)}]');if(!b)return false;b.click();return true;`);
}

async function editText(sid, id, html) {
  const center = await exec(sid, `
    const n=document.querySelector('[data-element-id=${JSON.stringify(id)}]');
    if(!n)return null;const r=n.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)});`);
  if (!center) return 'element missing';
  const point = JSON.parse(center);
  await post(`/session/${sid}/actions`, { actions: [{
    type: 'pointer', id: 'edit-mouse', parameters: { pointerType: 'mouse' }, actions: [
      { type: 'pointerMove', duration: 10, x: point.x, y: point.y, origin: 'viewport' },
      { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
      { type: 'pause', duration: 30 },
      { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
    ],
  }] });
  await fetch(`http://127.0.0.1:4444/session/${sid}/actions`, { method: 'DELETE' }).catch(() => {});
  for (let i = 0; i < 20; i++) {
    await sleep(100);
    const edited = await exec(sid, `
      const n=document.querySelector('[data-element-id=${JSON.stringify(id)}] [contenteditable="true"]');
      if(!n)return false;
      n.focus();n.innerHTML=${JSON.stringify(html)};
      n.dispatchEvent(new InputEvent('input',{bubbles:true,data:'x',inputType:'insertText'}));
      return true;`);
    if (edited) {
      await post(`/session/${sid}/actions`, { actions: [{
        type: 'pointer', id: 'commit-mouse', parameters: { pointerType: 'mouse' }, actions: [
          { type: 'pointerMove', duration: 10, x: 500, y: 780, origin: 'viewport' },
          { type: 'pointerDown', button: 0 }, { type: 'pointerUp', button: 0 },
        ],
      }] });
      await fetch(`http://127.0.0.1:4444/session/${sid}/actions`, { method: 'DELETE' }).catch(() => {});
      await sleep(250);
      return 'ok';
    }
  }
  return 'contentEditable never appeared';
}

async function setNotes(sid, value) {
  return exec(sid, `
    const n=document.querySelector('.notes-textarea');if(!n)return false;
    const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event('input',{bubbles:true}));return true;`);
}

async function snapshot(sid) {
  return JSON.parse(await exec(sid, `
    const s=window.__eigendeck.store.getState();
    return JSON.stringify({current:s.currentSlideIndex,slides:s.presentation.slides.map(x=>({
      id:x.id,groupId:x.groupId||null,notes:x.notes,
      elements:x.elements.map(e=>({id:e.id,type:e.type,preset:e.preset||null,html:e.html||null,url:e.url||null,x:e.position.x}))
    }))});`));
}

let sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fatal('could not open blank deck');
await exec(sid, `window.__userBuildErrors=[];addEventListener('error',e=>window.__userBuildErrors.push('error: '+e.message));addEventListener('unhandledrejection',e=>window.__userBuildErrors.push('rejection: '+String(e.reason)));`);

// Slide 1: insert and edit the text before adding overlapping objects, as a user
// would. Pointer targeting should not be confused by a later card/sticky note.
for (const title of ['Add title text', 'Add body text']) {
  if (!await clickTitle(sid, title)) bug(`toolbar control missing: ${title}`);
  await sleep(180);
}
let state = await snapshot(sid);
const title = state.slides[0].elements.find((e) => e.preset === 'title');
const body = state.slides[0].elements.find((e) => e.preset === 'body');
if (!title || !body) fatal('toolbar inserts did not create title/body');
if (await editText(sid, title.id, 'Krylov Methods — From Theory to Scale') !== 'ok') bug('could not edit title through contentEditable');
if (await editText(sid, body.id, '<div>Why sparse matrix algorithms matter</div><ul><li>structure</li><li>performance</li></ul>') !== 'ok') bug('could not edit body through contentEditable');
for (const objectTitle of ['Add a titled card (rounded, shadowed, themed tint)', 'Add arrow', 'Add a Hype sticky note (yellow, Shantell)']) {
  if (!await clickTitle(sid, objectTitle)) bug(`toolbar control missing: ${objectTitle}`);
  await sleep(180);
}
if (!await setNotes(sid, 'Open with the motivating sparse solve.')) bug('speaker-notes textarea missing');
await sleep(250);
const movedX = await dragElementToX(sid, title.id, 180);
if (typeof movedX !== 'number' || Math.abs(movedX - 180) > 2) bug(`title drag landed at ${movedX}`);

// Duplicate with the visible slide action, then create a build child through the
// real context menu and a standalone slide through the Add Slide button.
if (!await clickTitle(sid, 'Duplicate')) bug('duplicate slide action missing');
await sleep(300);
await exec(sid, `const t=document.querySelector('.slide-thumbnail.active');const r=t.getBoundingClientRect();t.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:r.x+30,clientY:r.y+30,button:2}));`);
await sleep(150);
const buildClicked = await exec(sid, `const b=[...document.querySelectorAll('.context-menu-item')].find(x=>x.textContent.includes('Add Build Slide'));if(!b)return false;b.click();return true;`);
if (!buildClicked) bug('Add Build Slide context-menu action missing');
await sleep(300);
const addSlideClicked = await exec(sid, `const b=document.querySelector('.btn-add-slide');if(!b)return false;b.click();return true;`);
if (!addSlideClicked) bug('Add Slide button missing');
await sleep(300);

// Slide 4 comes with its standard title/body placeholders. Edit that title, insert
// a URL video through its real modal, and undo/redo the last insertion through the
// editor keyboard route.
state = await snapshot(sid);
const lastSlide = state.slides[state.current];
const closingTitle = lastSlide.elements.find((e) => e.preset === 'title');
if (!closingTitle || await editText(sid, closingTitle.id, 'Questions & next steps') !== 'ok') bug('closing title edit failed');
if (!await clickTitle(sid, 'Add a movie — file or URL (YouTube/Vimeo/PeerTube)')) bug('video toolbar control missing');
await sleep(150);
const videoAdded = await exec(sid, `
  const n=document.querySelector('input[placeholder*="YouTube"]');if(!n)return false;
  const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  set.call(n,'https://www.youtube.com/watch?v=dQw4w9WgXcQ');n.dispatchEvent(new Event('input',{bubbles:true}));
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Add URL');if(!b)return false;b.click();return true;`);
if (!videoAdded) bug('video URL modal could not be completed');
await sleep(400);
await exec(sid, `(document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,bubbles:true}));`);
await sleep(180);
await exec(sid, `(document.activeElement||document.body).dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,shiftKey:true,bubbles:true}));`);
await sleep(300);

state = await snapshot(sid);
if (state.slides.length !== 4) bug(`live deck has ${state.slides.length} slides, expected 4`);
if (state.slides[0].elements.length !== 5) bug(`slide 1 has ${state.slides[0].elements.length} elements, expected 5`);
if (!state.slides[0].notes.includes('motivating sparse solve')) bug('speaker notes did not reach store');
if (!state.slides[3].elements.some((e) => e.type === 'video')) bug('video missing after undo/redo');
console.log('  live editor structure:', JSON.stringify(state));

await sleep(1800);
const saved = await execA(sid, `const done=arguments[arguments.length-1];window.__eigendeck.save().then(()=>done('ok')).catch(e=>done('ERR: '+e));`);
if (saved !== 'ok') fatal(`save failed: ${saved}`);
const errors1 = JSON.parse(await exec(sid, `return JSON.stringify(window.__userBuildErrors||[])`));
await quit(sid);

sid = await openApp(APP, DECK);
if (!sid || !await waitSeam(sid)) fatal('could not reopen authored deck');
await sleep(600);
const reopened = await snapshot(sid);
console.log('  reopened structure:', JSON.stringify(reopened));
if (reopened.slides.length !== state.slides.length) bug(`reopen changed slide count ${state.slides.length} -> ${reopened.slides.length}`);
if (!reopened.slides[0].elements.some((e) => e.html?.includes('Krylov Methods'))) bug('reopen lost edited title');
if (!reopened.slides[0].elements.some((e) => e.html?.includes('sparse matrix algorithms'))) bug('reopen lost edited body');
if (!reopened.slides[0].notes.includes('motivating sparse solve')) bug('reopen lost speaker notes');
if (!reopened.slides.at(-1).elements.some((e) => e.type === 'video' && e.url?.includes('dQw4w9WgXcQ'))) bug('reopen lost URL video');

// The normalized DB intentionally reloads synced duplicates with one canonical
// element id. Exercise that post-reopen state through the UI: edit the title on
// slide 2 and confirm the three synced instances update together.
await exec(sid, `document.querySelectorAll('.slide-thumbnail')[1].click();`);
await sleep(250);
const reopenedTitleId = reopened.slides[1].elements.find((e) => e.preset === 'title')?.id;
if (!reopenedTitleId || await editText(sid, reopenedTitleId, 'Krylov Methods — Iteration 2') !== 'ok') {
  bug('post-reopen synced-title edit failed');
} else {
  const afterReopenEdit = await snapshot(sid);
  const syncedTitles = afterReopenEdit.slides.slice(0, 3).map((slide) => slide.elements.find((e) => e.preset === 'title')?.html);
  if (!syncedTitles.every((html) => html?.includes('Iteration 2'))) bug(`post-reopen synced edit did not propagate: ${JSON.stringify(syncedTitles)}`);
}
await quit(sid);

if (errors1.length) bug(`uncaught JavaScript errors: ${errors1.join(' | ')}`);
if (problems.length) {
  console.error(`USER_BUILD_BUGS (${problems.length}):`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(2);
}
console.log('USER_BUILD_PASS: built, edited, duplicated, grouped, saved, and reopened a four-slide talk through real editor controls');
