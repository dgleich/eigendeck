// Verify the S badge renders for a synced element AFTER save→reopen (same canonical id).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const save=sid=>execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));");
const fail=m=>{console.error('BADGE_FAIL:',m);process.exit(1);};

let sid=await open(); if(!sid||!await waitSeam(sid)) fail('S1');
await exec(sid,"window.__eigendeck.store.getState().addElement({id:'title1',type:'text',preset:'title',html:'Title',position:{x:160,y:400,width:1600,height:140}});");
await sleep(300);
await exec(sid,"window.__eigendeck.store.getState().duplicateSlide(0);");
await sleep(300);
if(await save(sid)!=='ok') fail('save'); await sleep(800); await quit(sid);

sid=await open(); if(!sid||!await waitSeam(sid)) fail('S2'); await sleep(600);
// confirm both slides have title1 with syncId
const ids=await exec(sid,"return JSON.stringify(window.__eigendeck.store.getState().presentation.slides.map(s=>s.elements.map(e=>({id:(e.id||'').slice(0,6),sync:!!e.syncId,link:!!e.linkId}))));");
console.log('  reopened state:', ids);
// select the title on slide 0, then read its badges from the DOM
await exec(sid,"window.__eigendeck.store.getState().selectSlide(0); window.__eigendeck.store.getState().selectObject({type:'element',id:'title1'});");
await sleep(700);
const badges=await exec(sid,`
  const host=document.querySelector('[data-element-id="title1"]');
  if(!host) return 'NO_HOST';
  return JSON.stringify({
    S: !!host.querySelector('.el-badge-sync'),
    A: !!host.querySelector('.el-badge-anim'),
    L: !!host.querySelector('.el-badge-link'),
    sOff: !!host.querySelector('.el-badge-off'),
  });`);
console.log('  badges on selected title:', badges);
await quit(sid);
const b=JSON.parse(badges);
if(!b.S) { console.error('BADGE_BUG: S (el-badge-sync) NOT rendered after reopen'); process.exit(2); }
if(!b.A || !b.L) { console.error('BADGE_FAIL: A or L missing: '+badges); process.exit(2); }
console.log('BADGE_PASS: S+A+L all render for the synced title after reopen');
process.exit(0);
