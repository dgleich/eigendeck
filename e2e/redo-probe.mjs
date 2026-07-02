// Verify REDO works across add, gesture (drag), and a REAL text-edit commit.
import { dragElementToX } from './_ui.mjs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const undo=sid=>exec(sid,"window.__eigendeck.store.temporal.getState().undo();");
const redo=sid=>exec(sid,"window.__eigendeck.store.temporal.getState().redo();");
const clear=sid=>exec(sid,"window.__eigendeck.store.temporal.getState().clear();");
const has=(sid,id)=>exec(sid,"return !!window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');");
const xOf=(sid,id)=>exec(sid,"const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');return e?e.position.x:-999;");
const htmlOf=(sid,id)=>exec(sid,"const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');return e?e.html:'GONE';");
const probs=[];
const sid=await open(); if(!sid||!await waitSeam(sid)){console.error('REDO_FAIL: open');process.exit(1);}

// 1) ADD: undo removes, redo restores
await clear(sid);
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'a',type:'text',preset:'body',html:'A',position:{x:50,y:50,width:200,height:80}});");
await sleep(300); await undo(sid); await sleep(150);
if(await has(sid,'a')) probs.push('add/undo: still present');
await redo(sid); await sleep(150);
if(!await has(sid,'a')) probs.push('add/REDO: not restored');
console.log('  add: undo+redo', !probs.length?'ok':'FAIL');

// 2) DRAG (REAL pointer gesture → the renderer's real pauseUndo/resumeUndo grouping):
//    a drag collapses to ONE undo step, so undo→pre-drag, redo→dragged.
const xDragged = await dragElementToX(sid, 'a', 400);
await sleep(250);
if(xDragged!==400) probs.push('drag did not land at 400 (got '+xDragged+')');
await undo(sid); await sleep(150);
const xUndo=await xOf(sid,'a');
if(xUndo!==50) probs.push('drag/undo x='+xUndo+' (want 50 — drag was not one undo step)');
await redo(sid); await sleep(150);
const xRedo=await xOf(sid,'a');
if(xRedo!==400) probs.push('drag/REDO x='+xRedo+' (want 400)');
if(!await has(sid,'a')) probs.push('drag/redo: element vanished');
console.log('  drag: dragged x='+xDragged+' undo x='+xUndo+' redo x='+xRedo);

// 3) REAL text edit commit: type into contentEditable, commit, undo, redo
await exec(sid,"document.querySelector('[data-element-id=\"a\"]').dispatchEvent(new CustomEvent('start-editing'));");
await sleep(500);
await exec(sid,"const ce=document.querySelector('[data-element-id=\"a\"] [contenteditable=\"true\"]'); ce.focus(); ce.innerHTML='EDITED';");
await sleep(200);
// commit via outside pointerdown
await exec(sid,"document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:700}));");
await sleep(400);
const hCommit=await htmlOf(sid,'a');
if(!hCommit.includes('EDITED')) probs.push('text commit not stored: "'+hCommit+'"');
await undo(sid); await sleep(150);
const hUndo=await htmlOf(sid,'a');
if(hUndo.includes('EDITED')) probs.push('text/undo did not revert: "'+hUndo+'"');
await redo(sid); await sleep(150);
const hRedo=await htmlOf(sid,'a');
if(!hRedo.includes('EDITED')) probs.push('text/REDO did not restore: "'+hRedo+'"');
console.log('  text: commit="'+hCommit+'" undo="'+hUndo+'" redo="'+hRedo+'"');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(probs.length){ console.error('REDO_BUGS: '+probs.join(' | ')); process.exit(2); }
console.log('REDO_PASS: redo works for add, drag-gesture, and text-edit commit');
process.exit(0);
