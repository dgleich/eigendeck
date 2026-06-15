// Bug hunt: z-order ops + persistence, and slide duplication.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=(m)=>{console.error('ZO_FAIL:',m);process.exit(1);};
const order=(sid,slideIdx=0)=>exec(sid,`return window.__eigendeck.store.getState().presentation.slides[${slideIdx}].elements.map(e=>e.id).join(',');`);
const nSlides=(sid)=>exec(sid,"return window.__eigendeck.store.getState().presentation.slides.length;");
const problems=[];

let sid=await open(); if(!sid||!await waitSeam(sid)) fail('S1 open');
for(const id of ['a','b','c']) await exec(sid,`window.__eigendeck.store.getState().addElement({id:'${id}',type:'text',preset:'body',html:'${id}',position:{x:100,y:100,width:200,height:80}});`);
await sleep(300);
if(await order(sid)!=='a,b,c') problems.push('initial order != a,b,c ('+await order(sid)+')');
await exec(sid,"window.__eigendeck.store.getState().moveElementZ('a','top');");
await sleep(200);
if(await order(sid)!=='b,c,a') problems.push("moveZ('a','top') → "+await order(sid)+' (want b,c,a)');
await exec(sid,"window.__eigendeck.store.getState().moveElementZ('c','bottom');");
await sleep(200);
if(await order(sid)!=='c,b,a') problems.push("moveZ('c','bottom') → "+await order(sid)+' (want c,b,a)');
console.log('  z-order ops:', await order(sid));

// persist
if(await execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));")!=='ok') fail('save');
await sleep(800); await quit(sid);
sid=await open(); if(!sid||!await waitSeam(sid)) fail('S2 open');
await sleep(500);
const reopened=await order(sid);
if(reopened!=='c,b,a') problems.push('z-order NOT persisted: reopened='+reopened+' (want c,b,a)');
console.log('  z-order after reopen:', reopened);

// slide duplicate
await exec(sid,"window.__eigendeck.store.getState().duplicateSlide(0);");
await sleep(400);
const ns=await nSlides(sid);
if(ns!==2) problems.push('duplicateSlide → '+ns+' slides (want 2)');
else {
  const dupOrder=await order(sid,1);
  const dupCount=dupOrder.split(',').filter(Boolean).length;
  if(dupCount!==3) problems.push('duplicated slide has '+dupCount+' elements (want 3): '+dupOrder);
  console.log('  duplicated slide elements:', dupOrder);
}
await quit(sid);
if(problems.length){ console.error('ZO_BUGS: '+problems.join(' | ')); process.exit(2); }
console.log('ZO_PASS: z-order ops + persistence + slide duplicate OK');
process.exit(0);
