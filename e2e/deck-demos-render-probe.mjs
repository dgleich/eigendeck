// Verify a deck's demos actually RENDER. Opens E2E_DECK, walks every slide that
// has a demo / demo-piece, and asserts each demo iframe's contentDocument is
// reachable and non-empty (it loaded + ran without crashing). Used to exercise
// the real talk-deck demos (magnetic-powers, local-networks) — which nothing else
// covered — and, with E2E_EXPECT, to prove hyphenated demo-piece names route
// end-to-end (#44): the demo renders "FORCE-GRAPH OK" only if 'force-graph' wasn't
// truncated.
//
// Env: E2E_DECK (required), E2E_APP, E2E_EXPECT (optional, comma-separated strings
//      that must EACH appear in some demo iframe's body text).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const EXPECT=(process.env.E2E_EXPECT||'').split(',').map(s=>s.trim()).filter(Boolean);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('DEMORENDER_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
const demoSlides=await exec(sid,`return window.__eigendeck.store.getState().presentation.slides
  .map((s,i)=>({i, n:s.elements.filter(e=>e.type==='demo'||e.type==='demo-piece').length}))
  .filter(s=>s.n>0);`);
if(!demoSlides||!demoSlides.length) fail('deck has no demo/demo-piece elements');
const totalDemos=demoSlides.reduce((a,s)=>a+s.n,0);
console.log(`  ${demoSlides.length} demo slides, ${totalDemos} demo elements`);

let rendered=0, empties=[]; const bodies=[];
for(const {i,n} of demoSlides){
  await exec(sid,`window.__eigendeck.store.getState().selectSlide(${i});`);
  await sleep(700);
  // wait for the iframes on this slide to have a reachable doc + some content
  let r=null;
  for(let k=0;k<10;k++){
    r=await exec(sid,`
      const ifr=[...document.querySelectorAll('.slide-canvas iframe')];
      return ifr.map(f=>{ try{ const d=f.contentDocument; if(!d||!d.body) return {ok:false};
        return {ok:(d.body.childElementCount>0)||((d.body.textContent||'').trim().length>0),
                txt:(d.body.textContent||'').slice(0,2000)}; }catch(e){ return {ok:false,err:String(e.message)}; } });`);
    if(r && r.length>=n && r.filter(x=>x.ok).length>=n) break;
    await sleep(500);
  }
  const ok=(r||[]).filter(x=>x.ok);
  rendered+=ok.length;
  for(const x of ok) bodies.push(x.txt||'');
  if(ok.length<n) empties.push(`slide ${i}: ${ok.length}/${n} demo iframes rendered`);
}
console.log(`  rendered ${rendered}/${totalDemos} demo iframes`);
if(empties.length){ for(const e of empties) console.log('   - '+e); fail(`${empties.length} slide(s) had non-rendering demos`); }
// content assertions (hyphen routing)
for(const want of EXPECT){
  if(!bodies.some(b=>b.includes(want))) fail(`expected text not found in any demo iframe: "${want}"`);
  console.log(`  ✓ found "${want}"`);
}
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('DEMORENDER_PASS: all demos rendered'+(EXPECT.length?` (+${EXPECT.length} content checks)`:''));
process.exit(0);
