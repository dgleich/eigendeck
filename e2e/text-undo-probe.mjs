// While editing a text box, Cmd+Z must NOT trigger STORE undo (native handles it);
// outside editing, Cmd+Z DOES trigger store undo.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const past=sid=>exec(sid,"return window.__eigendeck.store.temporal.getState().pastStates.length;");
const htmlOf=(sid,id)=>exec(sid,"const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');return e?e.html:'GONE';");
const cmdZ=(sid,sel)=>exec(sid,"const t="+sel+"; t.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,bubbles:true}));");
const probs=[];
const sid=await open(); if(!sid||!await waitSeam(sid)){console.error('TU_FAIL: open');process.exit(1);}

await exec(sid,"window.__eigendeck.store.getState().addElement({id:'k',type:'text',preset:'body',html:'orig',position:{x:100,y:100,width:300,height:120}});");
await sleep(300);
// One deterministic store step (orig → changed) via a REAL text edit: enter editing,
// change the contentEditable, commit by clicking outside. (No pause/resume seam.)
await exec(sid,"document.querySelector('[data-element-id=\"k\"]').dispatchEvent(new CustomEvent('start-editing'));");
await sleep(500);
await exec(sid,"const ce=document.querySelector('[data-element-id=\"k\"] [contenteditable=\"true\"]'); ce.focus(); ce.innerHTML='changed';");
await sleep(200);
await exec(sid,"document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,clientX:5,clientY:700}));");
await sleep(400);

// (B) OUTSIDE editing: Cmd+Z on body SHOULD store-undo → back to 'orig'
const nB=await past(sid);
await cmdZ(sid,"document.body"); await sleep(250);
const nBa=await past(sid), hBa=await htmlOf(sid,'k');
if(nBa!==nB-1) probs.push('outside: store undo did not fire ('+nB+'→'+nBa+')');
if(hBa!=='orig') probs.push('outside: did not revert to orig ('+hBa+')');
console.log('  outside: past '+nB+'→'+nBa+', html="'+hBa+'"');

// (A) GUARD: enter edit, Cmd+Z on the contentEditable must NOT store-undo
await exec(sid,"document.querySelector('[data-element-id=\"k\"]').dispatchEvent(new CustomEvent('start-editing'));");
await sleep(500);
const nA=await past(sid), hA=await htmlOf(sid,'k');
await cmdZ(sid,"document.querySelector('[data-element-id=\"k\"] [contenteditable=\"true\"]')"); await sleep(250);
const nAa=await past(sid), hAa=await htmlOf(sid,'k');
if(nAa!==nA) probs.push('editing: store undo FIRED ('+nA+'→'+nAa+')');
if(hAa!==hA) probs.push('editing: store state changed ('+hA+'→'+hAa+')');
console.log('  editing: past '+nA+'→'+nAa+', html="'+hA+'"→"'+hAa+'" (want unchanged)');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(probs.length){ console.error('TU_BUGS: '+probs.join(' | ')); process.exit(2); }
console.log('TU_PASS: Cmd+Z native inside text boxes, store-level outside');
process.exit(0);
