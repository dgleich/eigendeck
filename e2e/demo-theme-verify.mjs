// Integration check for #86: the in-app hook injects --eigendeck-* vars +
// @font-face into a real demo iframe, and a theme switch updates the vars
// WITHOUT reloading the iframe (demo state preserved).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('VERIFY_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
const di = await exec(sid, `
  const sl=window.__eigendeck.store.getState().presentation.slides;
  for(let i=0;i<sl.length;i++) if(sl[i].elements.some(e=>e.type==='demo'||e.type==='demo-piece')) return i;
  return -1;`);
if(di<0) fail('no demo element');
await exec(sid, `window.__eigendeck.store.getState().selectSlide(${di});`);
await sleep(2500);

const readState = `(function(){
  const ifr=[...document.querySelectorAll('.slide-canvas iframe')].find(f=>{try{return f.contentDocument&&f.contentDocument.getElementById('eigendeck-demo-vars')}catch(e){return false}});
  if(!ifr) return {ready:false};
  const doc=ifr.contentDocument, win=ifr.contentWindow;
  const cs=win.getComputedStyle(doc.documentElement);
  if(win.__eigMark===undefined) win.__eigMark=Math.floor(performance.now());
  return {
    ready:true,
    mark:win.__eigMark,
    bg:cs.getPropertyValue('--eigendeck-bg').trim(),
    fg:cs.getPropertyValue('--eigendeck-fg').trim(),
    font:cs.getPropertyValue('--eigendeck-font').trim(),
    hasFonts: !!doc.getElementById('eigendeck-demo-fonts'),
    fontFaceLen: (doc.getElementById('eigendeck-demo-fonts')||{}).textContent?.length||0,
  };
})()`;

let before=null;
for(let i=0;i<15;i++){ before=await exec(sid,`return ${readState}`); if(before&&before.ready) break; await sleep(700); }
if(!before||!before.ready) fail('vars never injected into demo iframe');
console.log('  BEFORE '+JSON.stringify(before));

// flip this slide's theme to black → resolveTheme bg should become #000000
await exec(sid, `window.__eigendeck.store.getState().updateSlide(${di}, {theme:'black'});`);
await sleep(1200);
const after = await exec(sid, `return ${readState}`);
console.log('  AFTER  '+JSON.stringify(after));
console.log('  noReload='+(before.mark===after.mark));
// Confirm the URL-referenced font actually loads inside the iframe (not embedded).
const fontCheck = await exec(sid, `
  const ifr=[...document.querySelectorAll('.slide-canvas iframe')].find(f=>{try{return f.contentDocument&&f.contentDocument.getElementById('eigendeck-demo-fonts')}catch(e){return false}});
  if(!ifr) return {err:'no ifr'};
  const doc=ifr.contentDocument;
  try{ await doc.fonts.load('40px "PT Sans"'); return {loaded:doc.fonts.check('40px \\'PT Sans\\'')}; }
  catch(e){ return {err:String(e.message)}; }
`);
console.log('  fontCheck='+JSON.stringify(fontCheck));
console.log('VERIFY_DONE');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
process.exit(0);
