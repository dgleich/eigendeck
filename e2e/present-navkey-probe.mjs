// #155: a focused demo iframe swallows Space/arrows in present mode. The demo
// bridge forwards unconsumed nav keys to the parent as a postMessage; PresentMode
// routes them into navigation. This probe verifies the PARENT half — a nav-key
// message advances/retreats the presentation (the in-iframe forwarder is a string
// in demoBridge.ts; cross-opaque-iframe keydown can't be driven headlessly).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('NAVKEY_FAIL:',m);process.exit(1);};
const idx=sid=>exec(sid,"return window.__eigendeck.store.getState().currentSlideIndex;");
const navKey=(sid,key)=>exec(sid,`window.dispatchEvent(new MessageEvent('message',{data:{__eigendeck:1,type:'nav-key',key:${JSON.stringify(key)}}}));`);
const waitIdx=async(sid,want)=>{for(let i=0;i<15;i++){if(await idx(sid)===want)return want;await sleep(200);}return await idx(sid);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
const n=await exec(sid,"return window.__eigendeck.store.getState().presentation.slides.length");
if(n<2) fail('need >=2 slides, got '+n);
await exec(sid,"window.__eigendeck.store.getState().selectSlide(0);");
await exec(sid,"window.__eigendeck.store.getState().setPresenting(true);");
await sleep(1000); // PresentMode mounts + attaches the message listener
if(await idx(sid)!==0) fail('start index not 0: '+await idx(sid));

// nav-key ArrowRight → advance
await navKey(sid,'ArrowRight');
if(await waitIdx(sid,1)!==1) fail('ArrowRight nav-key did not advance (idx '+await idx(sid)+')');
console.log('  nav-key ArrowRight → advanced to slide 1 ✓');
// nav-key ArrowLeft → back
await navKey(sid,'ArrowLeft');
if(await waitIdx(sid,0)!==0) fail('ArrowLeft nav-key did not retreat (idx '+await idx(sid)+')');
console.log('  nav-key ArrowLeft → back to slide 0 ✓');
// nav-key Space → advance
await navKey(sid,' ');
if(await waitIdx(sid,1)!==1) fail('Space nav-key did not advance (idx '+await idx(sid)+')');
console.log('  nav-key Space → advanced to slide 1 ✓');

await exec(sid,"window.__eigendeck.store.getState().setPresenting(false);");
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('NAVKEY_PASS: present-mode nav-key messages advance/retreat the deck (#155)');
process.exit(0);
