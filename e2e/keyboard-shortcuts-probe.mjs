// e2e: editor keyboard shortcuts drive the real store — arrow nudge (1px / 10px
// with Shift), z-order (Cmd+]), and Escape-to-deselect. Verifies the App.tsx
// keydown handler end-to-end (the helper deltas are unit-tested in
// src/lib/keyboardShortcuts.test.ts). Same-session store reads are authoritative
// for live position (no save needed — see eigendeck-e2e gotcha 7).
const BASE = 'http://127.0.0.1:4444', APP = process.env.E2E_APP, DECK = process.env.E2E_DECK;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function post(p, b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid, s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<20;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail = (m) => { console.error('KBD_FAIL:', m); process.exit(1); };

const sid = await open(); if (!sid || !await waitSeam(sid)) fail('open');

// Two text elements on the current slide; kbd2 added last → higher z-index.
await exec(sid, `const s=window.__eigendeck.store.getState();
  s.addElement({id:'kbd1',type:'text',preset:'body',content:'A',position:{x:100,y:100,width:200,height:50}});
  s.addElement({id:'kbd2',type:'text',preset:'body',content:'B',position:{x:400,y:100,width:200,height:50}});
  s.selectObject({type:'element',id:'kbd1'});`);

const pos = async () => JSON.parse(await exec(sid, `const s=window.__eigendeck.store.getState();
  const sl=s.presentation.slides[s.currentSlideIndex]; const el=sl.elements.find(e=>e.id==='kbd1');
  return JSON.stringify(el?el.position:null);`));
const idxOf = async (id) => Number(await exec(sid, `const s=window.__eigendeck.store.getState();
  const sl=s.presentation.slides[s.currentSlideIndex]; return sl.elements.findIndex(e=>e.id===${JSON.stringify(id)});`));
// Dispatch on document.body (a real element) so e.target has tagName/.closest —
// dispatching on window makes e.target the window and the handler's guard throws.
const key = (k, shift = false, meta = false) => exec(sid,
  `document.body.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},shiftKey:${shift},metaKey:${meta},ctrlKey:${meta},bubbles:true}));`);

// 1. Arrow nudge — 1px right
const p0 = await pos();
await key('ArrowRight'); await sleep(150);
const p1 = await pos();
if (p1.x !== p0.x + 1) fail(`nudge right: expected x ${p0.x + 1}, got ${p1.x}`);

// 2. Shift-arrow nudge — 10px down
await key('ArrowDown', true); await sleep(150);
const p2 = await pos();
if (p2.y !== p1.y + 10) fail(`shift-nudge down: expected y ${p1.y + 10}, got ${p2.y}`);

// 3. Z-order — Cmd+] raises kbd1 one step (its array index increases)
const zBefore = await idxOf('kbd1');
await key(']', false, true); await sleep(150);
const zAfter = await idxOf('kbd1');
if (zAfter <= zBefore) fail(`Cmd+] should raise kbd1: index ${zBefore} -> ${zAfter} (expected higher)`);

// 4. Escape deselects to the slide
await key('Escape'); await sleep(150);
const selType = await exec(sid, `return window.__eigendeck.store.getState().selectedObject?.type;`);
if (selType !== 'slide') fail(`Escape should deselect to slide, got ${selType}`);

// 5. Cmd+D on an ELEMENT duplicates it on the current slide (clipboard-free).
await exec(sid, `window.__eigendeck.store.getState().selectObject({type:'element',id:'kbd1'});`);
const nElBefore = Number(await exec(sid, `const s=window.__eigendeck.store.getState(); return s.presentation.slides[s.currentSlideIndex].elements.length;`));
await key('d', false, true); await sleep(200);
const nElAfter = Number(await exec(sid, `const s=window.__eigendeck.store.getState(); return s.presentation.slides[s.currentSlideIndex].elements.length;`));
if (nElAfter !== nElBefore + 1) fail(`Cmd+D on an element should duplicate it: ${nElBefore} -> ${nElAfter}`);

// 6. Cmd+D on a SLIDE duplicates the slide (clipboard-free, the Stage-5 add).
await exec(sid, `const s=window.__eigendeck.store.getState(); s.selectSlide(s.currentSlideIndex);`);
const nSlBefore = Number(await exec(sid, `return window.__eigendeck.store.getState().presentation.slides.length;`));
await key('d', false, true); await sleep(200);
const nSlAfter = Number(await exec(sid, `return window.__eigendeck.store.getState().presentation.slides.length;`));
if (nSlAfter !== nSlBefore + 1) fail(`Cmd+D on a slide should duplicate it: ${nSlBefore} -> ${nSlAfter}`);

console.log('KBD_PASS: nudge 1px/10px, Cmd+] z-order, Escape deselect, Cmd+D duplicate (element + slide)');
process.exit(0);
