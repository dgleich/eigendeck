// Bug hunt: multiple element types + key fields survive save→reopen.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execA(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
async function quit(sid){await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});}
const fail=m=>{console.error('KS_FAIL:',m);process.exit(1);};

let sid=await open(); if(!sid||!await waitSeam(sid)) fail('S1 open');
await exec(sid,`const s=window.__eigendeck.store.getState();
  s.addElement({id:'tx',type:'text',preset:'title',html:'Hi',color:'#dc2626',position:{x:10,y:10,width:300,height:80}});
  s.addElement({id:'ar',type:'arrow',x1:100,y1:100,x2:400,y2:300,position:{x:100,y:100,width:300,height:200}});
  s.addElement({id:'cv',type:'cover',color:'#1f2937',position:{x:0,y:0,width:1920,height:1080}});
  s.addElement({id:'vd',type:'video',kind:'embed',provider:'youtube',url:'https://youtu.be/ID12345',loop:true,playbackRate:1.5,position:{x:200,y:200,width:640,height:360}});`);
await sleep(500);
if(await execA(sid,"const d=arguments[arguments.length-1];window.__eigendeck.save().then(()=>d('ok')).catch(e=>d('ERR'+e));")!=='ok') fail('save');
await sleep(800); await quit(sid);

sid=await open(); if(!sid||!await waitSeam(sid)) fail('S2 open');
await sleep(600);
const got=await exec(sid,`const els=window.__eigendeck.store.getState().presentation.slides[0].elements;
  const by=id=>els.find(e=>e.id===id);
  return JSON.stringify({
    n: els.length,
    tx: by('tx') && {c:by('tx').color, h:by('tx').html},
    ar: by('ar') && {x1:by('ar').x1, x2:by('ar').x2},
    cv: by('cv') && {c:by('cv').color},
    vd: by('vd') && {prov:by('vd').provider, url:by('vd').url, loop:by('vd').loop, rate:by('vd').playbackRate}
  });`);
await quit(sid);
console.log('  reopened:', got);
const g=JSON.parse(got); const probs=[];
if(g.n!==4) probs.push('element count '+g.n+' (want 4)');
if(!g.tx||g.tx.c!=='#dc2626'||g.tx.h!=='Hi') probs.push('text fields: '+JSON.stringify(g.tx));
if(!g.ar||g.ar.x1!==100||g.ar.x2!==400) probs.push('arrow coords: '+JSON.stringify(g.ar));
if(!g.cv||g.cv.c!=='#1f2937') probs.push('cover color: '+JSON.stringify(g.cv));
if(!g.vd||g.vd.prov!=='youtube'||g.vd.loop!==true||g.vd.rate!==1.5) probs.push('video fields: '+JSON.stringify(g.vd));
if(probs.length){ console.error('KS_BUGS: '+probs.join(' | ')); process.exit(2); }
console.log('KS_PASS: text/arrow/cover/video-embed all survive save→reopen with fields');
process.exit(0);
