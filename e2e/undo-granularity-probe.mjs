// MEASURE undo granularity (#55): drag pause/resume + typing coalescing.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const past=sid=>exec(sid,"return window.__eigendeck.store.temporal.getState().pastStates.length;");
const xOf=(sid,id)=>exec(sid,"const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');return e?e.position.x:-999;");
const htmlOf=(sid,id)=>exec(sid,"const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');return e?e.html:'GONE';");
const has=(sid,id)=>exec(sid,"return !!window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');");
const clear=sid=>exec(sid,"window.__eigendeck.store.temporal.getState().clear();");
const undo=sid=>exec(sid,"window.__eigendeck.store.temporal.getState().undo();");
const pause=sid=>exec(sid,"window.__eigendeck.pauseUndo();");
const resume=sid=>exec(sid,"window.__eigendeck.resumeUndo();");

const sid=await open(); if(!sid||!await waitSeam(sid)){console.error('open fail');process.exit(1);}

// ---- DRAG test ----
await clear(sid);
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'a',type:'text',preset:'body',html:'A',position:{x:100,y:100,width:200,height:80}});");
await sleep(350);
const pAdd=await past(sid);
await pause(sid);
await exec(sid,"const s=window.__eigendeck.store.getState(); for(let x=140;x<=500;x+=90){ s.updateElement('a',{position:{x:x,y:100,width:200,height:80}}); }");
await resume(sid);
await sleep(350);
const pDrag=await past(sid);
const xBeforeUndo=await xOf(sid,'a');
await undo(sid); await sleep(200);
console.log('DRAG:', JSON.stringify({ pastAfterAdd:pAdd, pastAfterDrag:pDrag, xBeforeUndo, xAfterUndo:await xOf(sid,'a'), present:await has(sid,'a') }));

// ---- TYPING test ----
await clear(sid);
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'b',type:'text',preset:'body',html:'',position:{x:100,y:300,width:400,height:80}});");
await sleep(350);
const pTypeStart=await past(sid);
await execA(sid,"const d=arguments[arguments.length-1];(async()=>{ const set=v=>window.__eigendeck.store.getState().updateElement('b',{html:v}); const w='hello'; let cur=''; for(const ch of w){ cur+=ch; set(cur); await new Promise(r=>setTimeout(r,120)); } d('typed'); })();");
await sleep(350);
const pTypeEnd=await past(sid);
const htmlBefore=await htmlOf(sid,'b');
await undo(sid); await sleep(200);
console.log('TYPING:', JSON.stringify({ stepsBefore:pTypeStart, stepsAfter:pTypeEnd, addedSteps:pTypeEnd-pTypeStart, htmlBeforeUndo:htmlBefore, htmlAfterUndo:await htmlOf(sid,'b') }));

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('MEASURE_DONE');
process.exit(0);
