// Spike: directly test the in-demo capture round-trip. Selects SLIDE, picks a
// visible .el-demo-frame, postMessages a {type:'capture'} request from the
// parent, and reports the result (dataUrl length / error / timeout). Also dumps
// parent console.warn/error so a capturePreview failure is visible.
// Env: E2E_DECK, E2E_APP, SLIDE.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const SLIDE=parseInt(process.env.SLIDE||'0',10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function execA(s,x){return (await post(`/session/${s}/execute/async`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('CAPTEST_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
await exec(sid,`window.__warns=[]; const _w=console.warn,_e=console.error;
  console.warn=function(){window.__warns.push('warn: '+[...arguments].map(String).join(' '));return _w.apply(console,arguments);};
  console.error=function(){window.__warns.push('err: '+[...arguments].map(String).join(' '));return _e.apply(console,arguments);};`);
await exec(sid,`window.__eigendeck.store.getState().selectSlide(${SLIDE});`);
await sleep(3500);

const frames=await exec(sid,`return [...document.querySelectorAll('iframe.el-demo-frame')].map(f=>({w:f.clientWidth,h:f.clientHeight}));`);
console.log('  el-demo-frames:', JSON.stringify(frames));

const res=await execA(sid,`
  const done=arguments[arguments.length-1];
  const ifr=[...document.querySelectorAll('iframe.el-demo-frame')].filter(f=>f.clientWidth>0)[0];
  if(!ifr){ done({err:'no visible demo iframe'}); return; }
  const id='probeCap';
  const onMsg=(e)=>{ const d=e.data; if(d&&d.__eigendeck===1&&d.type==='capture-result'&&d.id===id){ window.removeEventListener('message',onMsg); done({dataUrlLen:(d.dataUrl||'').length, error:d.error||null}); } };
  window.addEventListener('message',onMsg);
  try { ifr.contentWindow.postMessage({__eigendeck:1,type:'capture',id,width:400,height:300,backgroundColor:'#ffffff'},'*'); }
  catch(e){ done({err:'postMessage threw: '+e.message}); return; }
  setTimeout(()=>{ window.removeEventListener('message',onMsg); done({err:'timeout (no capture-result in 8s)'}); }, 8000);
`);
console.log('  DIRECT capture result:', JSON.stringify(res));
const warns=await exec(sid,`return (window.__warns||[]).slice(0,20);`);
console.log('  parent warns/errors:', JSON.stringify(warns,null,1));
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('CAPTEST_DONE');
process.exit(0);
