// #86 scenario test: a demo on every (font × theme) combo. Builds a 40-slide
// deck (10 FONT_PACKAGES × 4 themes), each slide a full-bleed theme-probe demo,
// and asserts in the demo's iframe that — for that slide — every --eigendeck-*
// color var resolves to the theme color AND the deck font actually loads. Also
// persists the deck (PROBE_OUT) so it can be opened and eyeballed.
import { readFileSync } from 'node:fs';
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const DEMO_HTML=readFileSync('/work/e2e/fixtures/theme-probe-demo.html','utf8');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('SCENARIO_FAIL:',m);process.exit(1);};

// id → bare @font-face family (from fontRegistry FONT_PACKAGES)
const FONTS=[['ptsans','PT Sans'],['lato','Lato'],['libertinus','Libertinus Serif'],
  ['libertinus-sans','Libertinus Sans'],['lm-sans','CMU Sans Serif'],['noto-sans','Noto Sans'],
  ['source-sans','Source Sans 3'],['source-code','Source Code Pro'],['shantell','Shantell Sans'],
  ['concrete-euler','CMU Concrete']];
const THEMES={
  white:{bg:'#ffffff',fg:'#222222',heading:'#222222',accent:'#2563eb',muted:'#888888'},
  light:{bg:'#f5f0e8',fg:'#2c2418',heading:'#2c2418',accent:'#1e5c99',muted:'#8c7e6a'},
  dark:{bg:'#1a1a2e',fg:'#e8e8e8',heading:'#f0f0f0',accent:'#60a5fa',muted:'#9ca3af'},
  black:{bg:'#000000',fg:'#ffffff',heading:'#ffffff',accent:'#93c5fd',muted:'#9ca3af'},
};
const hexToRgb=h=>{const n=parseInt(h.slice(1),16);return `rgb(${(n>>16)&255}, ${(n>>8)&255}, ${n&255})`};
const combos=[]; for(const [fid,fam] of FONTS) for(const tn of Object.keys(THEMES)) combos.push({fid,fam,tn});

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
// trim the base deck to a single slide so the build yields exactly 40 (no leftover)
await exec(sid,'var g=window.__eigendeck.store.getState; while(g().presentation.slides.length>1){ g().deleteSlide(g().presentation.slides.length-1); } g().selectSlide(0);');

// store the demo once as a shared asset
const assetId=await exec(sid,`return await window.__TAURI_INTERNALS__.invoke('db_store_asset',{path:'demos/theme-probe.html',data:Array.from(new TextEncoder().encode(${JSON.stringify(DEMO_HTML)})),mimeType:'text/html',externalPath:null,externalMtime:null});`);
if(!assetId||typeof assetId!=='string') fail('db_store_asset returned '+JSON.stringify(assetId));
console.log('  stored demo asset '+assetId.slice(0,8));

// Build 40 slides = combos. Repurpose the base slide 0 for combo 0 (clearing its
// elements), addSlide for the rest. NB: call getState() FRESH for every action —
// a single getState() snapshot has a stale currentSlideIndex after addSlide().
{
  const c=combos[0];
  await exec(sid,`var g=window.__eigendeck.store.getState;g().selectSlide(0);g().updateSlide(0,{bodyFont:'${c.fid}',theme:'${c.tn}',elements:[]});g().addElement({id:'demo-0',type:'demo',assetId:${JSON.stringify(assetId)},position:{x:0,y:0,width:1920,height:1080}});`);
}
for(let k=1;k<combos.length;k++){
  const c=combos[k];
  await exec(sid,`var g=window.__eigendeck.store.getState;g().addSlide();var i=g().currentSlideIndex;g().updateSlide(i,{bodyFont:'${c.fid}',theme:'${c.tn}'});g().addElement({id:'demo-'+i,type:'demo',assetId:${JSON.stringify(assetId)},position:{x:0,y:0,width:1920,height:1080}});`);
}
const n=await exec(sid,'return window.__eigendeck.store.getState().presentation.slides.length');
console.log('  built '+n+' slides');

const readState=(fam)=>`return await (async()=>{
  const ifr=[...document.querySelectorAll('.slide-canvas iframe')].find(f=>{try{return f.contentDocument&&f.contentDocument.getElementById('sw-bg')}catch(e){return false}});
  if(!ifr) return {ready:false};
  const doc=ifr.contentDocument, win=ifr.contentWindow;
  const bg=id=>win.getComputedStyle(doc.getElementById(id)).backgroundColor;
  const root=win.getComputedStyle(doc.documentElement);
  const fam=${JSON.stringify(fam)};
  let fontLoaded=false;
  try{ await doc.fonts.load('32px "'+fam+'"'); fontLoaded=doc.fonts.check('32px "'+fam+'"'); }catch(e){}
  return {ready:true, swBg:bg('sw-bg'), swFg:bg('sw-fg'), swHeading:bg('sw-heading'),
    swAccent:bg('sw-accent'), swMuted:bg('sw-muted'),
    fontVar:root.getPropertyValue('--eigendeck-font').trim(), fontLoaded};
})()`;

const fails=[]; let ok=0;
for(let idx=0; idx<combos.length; idx++){
  const c=combos[idx], exp=THEMES[c.tn];
  await exec(sid,`window.__eigendeck.store.getState().selectSlide(${idx});`);
  await sleep(550);
  let r=null;
  for(let k=0;k<12;k++){ r=await exec(sid,readState(c.fam)); if(r&&r.ready) break; await sleep(500); }
  const tag=`[${idx}] ${c.fid}/${c.tn}`;
  if(!r||!r.ready){ fails.push(`${tag}: demo iframe not ready`); continue; }
  let slideOk=true;
  const colorChecks=[['bg',r.swBg,exp.bg],['fg',r.swFg,exp.fg],['heading',r.swHeading,exp.heading],['accent',r.swAccent,exp.accent],['muted',r.swMuted,exp.muted]];
  for(const [nm,got,wantHex] of colorChecks){ const want=hexToRgb(wantHex); if(got!==want){ fails.push(`${tag}: ${nm} ${got} != ${want}`); slideOk=false; } }
  if(!r.fontVar||!r.fontVar.includes(c.fam)){ fails.push(`${tag}: --eigendeck-font "${r.fontVar}" !~ "${c.fam}"`); slideOk=false; }
  if(!r.fontLoaded){ fails.push(`${tag}: font "${c.fam}" did not load`); slideOk=false; }
  if(slideOk) ok++;
}
console.log(`  PASS ${ok}/${combos.length} combos`);
if(fails.length){ console.log('  FAILURES:'); for(const f of fails.slice(0,50)) console.log('   - '+f); }
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log(fails.length? 'SCENARIO_RESULT: FAIL' : 'SCENARIO_RESULT: PASS');
process.exit(fails.length?1:0);
