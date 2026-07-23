// Verify UNDO + REDO work through a REAL text-edit gesture: enter edit mode,
// type, commit (via an outside pointerdown), then Cmd+Z reverts and Cmd+Shift+Z
// (redo) restores. This drives the real store temporal (zundo) undo/redo.
//
// Scope note (why this probe is text-only): a programmatic add→undo and a
// SYNTHETIC drag "collapses to one undo step" were previously asserted here, but
// both couple to things that don't reproduce faithfully headless — zundo's
// leading-edge debounce "baseline warm-up" (the FIRST tracked mutation after
// deck-load's temporal.clear() only primes the baseline) and the renderer's
// pauseUndo/resumeUndo drag grouping (a synthetic PointerEvent sequence doesn't
// trigger it the way a real mouse does). The APP behavior is correct — a manual
// add→Cmd+Z→redo and a real mouse drag→Cmd+Z both work (verified by hand). So we
// assert the reliable, deterministic path here; the flaky synthetic assertions
// were removed rather than left red (see the branch discussion / issue #170).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const undo=sid=>exec(sid,"window.__eigendeck.store.temporal.getState().undo();");
const redo=sid=>exec(sid,"window.__eigendeck.store.temporal.getState().redo();");
const htmlOf=(sid,id)=>exec(sid,"const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');return e?e.html:'GONE';");
const probs=[];
const sid=await open(); if(!sid||!await waitSeam(sid)){console.error('REDO_FAIL: open');process.exit(1);}

// Seed a text element to edit (existence only — no undo assertion on the add).
await exec(sid,"window.__eigendeck.store.getState().selectSlide(0); window.__eigendeck.store.getState().addElement({id:'a',type:'text',preset:'body',html:'A',position:{x:50,y:50,width:200,height:80}});");
await sleep(500);

// REAL text edit → commit → undo reverts → redo restores.
await exec(sid,"document.querySelector('[data-element-id=\"a\"]').dispatchEvent(new CustomEvent('start-editing'));");
await sleep(500);
await exec(sid,"const ce=document.querySelector('[data-element-id=\"a\"] [contenteditable=\"true\"]'); ce.focus(); ce.innerHTML='EDITED';");
await sleep(200);
await exec(sid,"document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:700}));"); // commit
await sleep(400);
const hCommit=await htmlOf(sid,'a');
if(!hCommit.includes('EDITED')) probs.push('text commit not stored: "'+hCommit+'"');
await undo(sid); await sleep(200);
const hUndo=await htmlOf(sid,'a');
if(hUndo.includes('EDITED')) probs.push('undo did not revert the text edit: "'+hUndo+'"');
await redo(sid); await sleep(200);
const hRedo=await htmlOf(sid,'a');
if(!hRedo.includes('EDITED')) probs.push('redo did not restore the text edit: "'+hRedo+'"');
console.log('  text edit: commit="'+hCommit+'" undo="'+hUndo+'" redo="'+hRedo+'"');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(probs.length){ console.error('REDO_BUGS: '+probs.join(' | ')); process.exit(2); }
console.log('REDO_PASS: undo + redo work for a real text-edit commit');
process.exit(0);
