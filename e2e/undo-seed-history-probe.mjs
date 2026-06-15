// Cross-session undo: edits+saves in S1 create history; S2 reopen seeds the undo
// stack so Cmd+Z walks back through saved versions.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const save=sid=>execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const past=sid=>exec(sid,"return window.__eigendeck.store.temporal.getState().pastStates.length;");
const htmlOf=(sid,id)=>exec(sid,"const e=window.__eigendeck.store.getState().presentation.slides[0].elements.find(x=>x.id==='"+id+"');return e?e.html:'GONE';");
const fail=m=>{console.error('SEED_FAIL:',m);process.exit(1);};
const probs=[];

// S1: build history — add + 2 edits, saving after each
let sid=await open(); if(!sid||!await waitSeam(sid)) fail('S1 open');
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'a',type:'text',preset:'body',html:'v1',position:{x:50,y:50,width:300,height:100}});");
if(await save(sid)!=='ok') fail('save v1'); await sleep(400);
await exec(sid,"window.__eigendeck.store.getState().updateElement('a',{html:'v2'});");
if(await save(sid)!=='ok') fail('save v2'); await sleep(400);
await exec(sid,"window.__eigendeck.store.getState().updateElement('a',{html:'v3'});");
if(await save(sid)!=='ok') fail('save v3'); await sleep(400);
await quit(sid);
console.log('  S1: saved v1→v2→v3');

// S2: reopen → seeded undo
sid=await open(); if(!sid||!await waitSeam(sid)) fail('S2 open');
await sleep(2500); // let the async seed warmup run
const seeded=await past(sid), hCur=await htmlOf(sid,'a');
console.log('  S2 reopen: pastStates='+seeded+', current html="'+hCur+'"');
if(seeded<1) probs.push('undo NOT seeded from history (pastStates='+seeded+')');
if(hCur!=='v3') probs.push('current not v3 ("'+hCur+'")');
// Cmd+Z across the session boundary → should revert to a prior saved version
await exec(sid,"document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,bubbles:true}));");
await sleep(300);
const hUndo=await htmlOf(sid,'a');
console.log('  after cross-session Cmd+Z: html="'+hUndo+'"');
if(hUndo==='v3'||hUndo==='GONE') probs.push('cross-session undo did not revert (html="'+hUndo+'")');

await quit(sid);
if(probs.length){ console.error('SEED_BUGS: '+probs.join(' | ')); process.exit(2); }
console.log('SEED_PASS: undo seeded from persisted history; Cmd+Z reverts across sessions');
process.exit(0);
