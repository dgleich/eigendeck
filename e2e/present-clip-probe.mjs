// #79 regression (e2e): in PRESENT mode, a text element whose content overflows
// its box must be CLIPPED to the box — not spill out (and, historically, not
// "pop in" late through the opacity-fade buffer). Asserts the rendered box div
// computes overflow:hidden AND that the content genuinely overflows it (so the
// clip is doing real work).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('CLIP79_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
// add a title that overflows its short box (the bug-79 shape: 4 lines in 120px)
await exec(sid, `var g=window.__eigendeck.store.getState; g().selectSlide(0);
  g().addElement({id:'ov79',type:'text',preset:'title',
    html:'Long title line one<div>line two of the title</div><div>line three keeps going</div><div>line four overflows the box bottom</div>',
    position:{x:120,y:380,width:1680,height:120}});`);
await sleep(400);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(true);");
for(let i=0;i<15;i++){ await sleep(400); if(await exec(sid,"return !!document.querySelector('.present-slide .el-text foreignObject')")) break; }

const r = await exec(sid, `
  const w=document.querySelector('.present-slide .el-text');
  if(!w) return {err:'no .el-text in present'};
  const box=w.querySelector('foreignObject > div'); if(!box) return {err:'no box div'};
  const cs=getComputedStyle(box);
  return { overflow:cs.overflow, overflowY:cs.overflowY, scrollH:box.scrollHeight, clientH:box.clientHeight };
`);
await exec(sid, "window.__eigendeck.store.getState().setPresenting(false);");
console.log('  present box:', JSON.stringify(r));
if(!r || r.err) fail(r?.err || 'no result');
const clipped = /hidden/.test(r.overflow) || /hidden/.test(r.overflowY||'');
const overflows = r.scrollH > r.clientH + 2;   // content really exceeds the box
if(!clipped) fail(`box does not clip (overflow="${r.overflow}") — #79 regression`);
if(!overflows) fail(`content did not overflow the box (scrollH ${r.scrollH} <= clientH ${r.clientH}); test is not exercising the clip`);
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log(`CLIP79_PASS: present-mode box clips overflow (overflow=${r.overflow}, content ${r.scrollH}px > box ${r.clientH}px)`);
process.exit(0);
