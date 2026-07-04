// Verify a deck's demos MOUNT + render under the OPAQUE-ORIGIN framework. Opens
// E2E_DECK, walks every slide with a demo / demo-piece, and asserts each demo
// mounted (an `iframe.el-demo-frame` exists and isn't the "not a valid demo"
// block) and didn't forward a crash (bridge `demo-error`). The parent can't read
// a demo's contentDocument anymore, so content assertions move to the bridge:
// with E2E_EXPECT, the demo must self-report the expected marker via
// {type:'piece-report'} (the hyphenpiece demo posts its routed piece name — proves
// hyphenated demo-piece names route end-to-end, #44).
// Env: E2E_DECK (required), E2E_APP, E2E_EXPECT (optional, comma-separated).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const EXPECT=(process.env.E2E_EXPECT||'').split(',').map(s=>s.trim()).filter(Boolean);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('DEMORENDER_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
// Collect bridge reports (opaque origin: can't read demo contentDocument).
await exec(sid,`window.__pr=[]; window.__derr=[]; window.addEventListener('message',e=>{var d=e.data; if(!d||d.__eigendeck!==1)return; if(d.type==='piece-report')window.__pr.push(String(d.text)); if(d.type==='demo-error')window.__derr.push(d.src+': '+String(d.message).slice(0,120));});`);
const demoSlides=await exec(sid,`return window.__eigendeck.store.getState().presentation.slides
  .map((s,i)=>({i, n:s.elements.filter(e=>e.type==='demo'||e.type==='demo-piece').length}))
  .filter(s=>s.n>0);`);
if(!demoSlides||!demoSlides.length) fail('deck has no demo/demo-piece elements');
const totalDemos=demoSlides.reduce((a,s)=>a+s.n,0);
console.log(`  ${demoSlides.length} demo slides, ${totalDemos} demo elements`);

let mounted=0; const empties=[];
for(const {i,n} of demoSlides){
  await exec(sid,`window.__eigendeck.store.getState().selectSlide(${i});`);
  await sleep(700);
  // wait for the slide's demo iframes to mount (opaque-origin: presence, not content)
  let r=null;
  for(let k=0;k<10;k++){
    r=await exec(sid,`
      const frames=document.querySelectorAll('iframe.el-demo-frame').length;
      const blocked=(document.body.textContent.match(/isn.t a valid Eigendeck demo/g)||[]).length;
      return {frames, blocked};`);
    if(r && r.frames>=n && r.blocked===0) break;
    await sleep(500);
  }
  const frames=(r&&r.frames)||0, blocked=(r&&r.blocked)||0;
  mounted+=Math.min(frames, n);
  if(blocked>0) empties.push(`slide ${i}: ${blocked} demo(s) BLOCKED (not a valid demo)`);
  else if(frames<n) empties.push(`slide ${i}: ${frames}/${n} demo iframes mounted`);
}
console.log(`  mounted ${mounted}/${totalDemos} demos`);
const errs=[...new Set(await exec(sid,`return window.__derr`)||[])];
if(errs.length){ console.log('  demo-errors:'); for(const e of errs.slice(0,10)) console.log('   - '+e); }
if(empties.length){ for(const e of empties) console.log('   - '+e); fail(`${empties.length} slide(s) had non-mounting/blocked demos`); }
// content assertions via bridge self-report (hyphen routing #44). Request a fresh
// report from every mounted demo (a load-time report can be missed if the demo
// mounted on the initial slide before our listener was installed).
if(EXPECT.length){
  for(let k=0;k<8;k++){
    await exec(sid,`document.querySelectorAll('iframe.el-demo-frame').forEach(f=>{try{f.contentWindow.postMessage({__eigendeck:1,type:'request-piece-report'},'*')}catch(e){}})`);
    await sleep(400);
  }
  const reports=await exec(sid,`return window.__pr`)||[];
  for(const want of EXPECT){
    if(!reports.some(t=>t.includes(want))) fail(`expected marker not self-reported by any demo: "${want}" (got: ${JSON.stringify(reports)})`);
    console.log(`  ✓ demo self-reported "${want}"`);
  }
}
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('DEMORENDER_PASS: all demos mounted'+(EXPECT.length?` (+${EXPECT.length} routed-marker checks)`:''));
process.exit(0);
