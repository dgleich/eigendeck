// Undo of an off-screen change jumps to that slide (real Cmd+Z keyboard path).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const idx=sid=>exec(sid,"return window.__eigendeck.store.getState().currentSlideIndex;");
const cmdZbody=sid=>exec(sid,"document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'z',metaKey:true,ctrlKey:true,bubbles:true}));");
const probs=[];
const sid=await open(); if(!sid||!await waitSeam(sid)){console.error('NAV_FAIL: open');process.exit(1);}

await exec(sid,"const s=window.__eigendeck.store.getState(); s.addSlide();"); // 2 slides, current=1
await sleep(300);
// change an element on slide 1 (current) as one deterministic step
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'x',type:'text',preset:'body',html:'X',position:{x:50,y:50,width:200,height:80}});");
await sleep(300);
// go to slide 0
await exec(sid,"window.__eigendeck.store.getState().selectSlide(0);");
await sleep(150);
const before=await idx(sid);
// real keyboard Cmd+Z on body → undoWithNav
await cmdZbody(sid); await sleep(300);
const after=await idx(sid);
if(before!==0) probs.push('setup: not on slide 0 (was '+before+')');
if(after!==1) probs.push('did NOT jump to the changed slide (idx '+before+'→'+after+', want 1)');
console.log('  off-screen undo: slide idx '+before+'→'+after+' (want 0→1)');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(probs.length){ console.error('NAV_BUGS: '+probs.join(' | ')); process.exit(2); }
console.log('NAV_PASS: undo jumps to the slide whose content was reverted');
process.exit(0);
