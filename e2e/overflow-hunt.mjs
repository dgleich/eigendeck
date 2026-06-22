// Hunt for text elements whose rendered content overflows its box (now clipped
// after the #79 fix). Walks every slide, measures each text element's content
// extent vs its box, reports overflowers. Layout extent is unchanged by the clip,
// so this surfaces exactly what is now cut off.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('HUNT_FAIL:',m);process.exit(1);};
const THRESH=6; // slide-units; ignore sub-6px noise (anti-aliasing, leading)

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
const n = await exec(sid, "return window.__eigendeck.store.getState().presentation.slides.length");
console.log('  deck has '+n+' slides');
const hits=[];
for(let i=0;i<n;i++){
  await exec(sid, `window.__eigendeck.store.getState().selectSlide(${i});`);
  await sleep(450);
  // let any math settle on this slide
  await sleep(250);
  const rows = await exec(sid, `
   try{
    const cv=document.querySelector('.slide-canvas'); if(!cv) return [];
    const scale=cv.getBoundingClientRect().width/1920;
    const px=v=>Math.round(v/scale);
    const out=[];
    for(const w of document.querySelectorAll('.slide-canvas [data-element-id]')){
      const divA=w.querySelector('foreignObject > div'); if(!divA) continue; // text elements only
      const divB=divA.querySelector(':scope > div'); if(!divB) continue;
      const o=w.getBoundingClientRect(), b=divB.getBoundingClientRect();
      const over={t:px(o.top-b.top), bot:px(b.bottom-o.bottom), l:px(o.left-b.left), r:px(b.right-o.right)};
      const max=Math.max(over.t,over.bot,over.l,over.r);
      if(max>=${THRESH}) out.push({id:w.getAttribute('data-element-id'), over, max});
    }
    return out;
   }catch(e){return [{ERR:String(e&&e.message||e)}];}
  `);
  for(const r of (rows||[])){ if(r.ERR){console.log('  slide '+(i+1)+' ERR '+r.ERR);continue;} hits.push({slide:i+1, ...r}); }
}
hits.sort((a,b)=>b.max-a.max);
console.log('  OVERFLOWERS='+JSON.stringify(hits));
console.log('  count='+hits.length);
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('HUNT_DONE');
process.exit(0);
