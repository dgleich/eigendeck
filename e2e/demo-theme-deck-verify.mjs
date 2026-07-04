// Verify an EXISTING deck's demos inherit each slide's theme + font (#86), under
// the OPAQUE-ORIGIN framework. Opens E2E_DECK, walks every slide, and for slides
// carrying a theme-probe demo asserts the demo's resolved --eigendeck-* colors
// match the slide's theme AND the slide's body font loads. The demo can no longer
// be read from the parent (opaque origin), so theme-probe-demo.html SELF-REPORTS
// via postMessage {type:'theme-report'} and we assert on that. Reusable for any
// deck built with the theme-probe demo (e.g. the CLI-built font×theme matrix).
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=(m)=>{console.error('DECKVERIFY_FAIL:',m);process.exit(1);};

const FONT_FAMILY={ptsans:'PT Sans',lato:'Lato',libertinus:'Libertinus Serif','libertinus-sans':'Libertinus Sans','lm-sans':'CMU Sans Serif','noto-sans':'Noto Sans','source-sans':'Source Sans 3','source-code':'Source Code Pro',shantell:'Shantell Sans','concrete-euler':'CMU Concrete'};
const THEMES={white:{bg:'#ffffff',fg:'#222222',heading:'#222222',accent:'#2563eb',muted:'#888888'},light:{bg:'#f5f0e8',fg:'#2c2418',heading:'#2c2418',accent:'#1e5c99',muted:'#8c7e6a'},dark:{bg:'#1a1a2e',fg:'#e8e8e8',heading:'#f0f0f0',accent:'#60a5fa',muted:'#9ca3af'},black:{bg:'#000000',fg:'#ffffff',heading:'#ffffff',accent:'#93c5fd',muted:'#9ca3af'}};
const hexToRgb=h=>{const n=parseInt(h.slice(1),16);return `rgb(${(n>>16)&255}, ${(n>>8)&255}, ${n&255})`};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
// Collect the demo's self-report (opaque origin: can't read its contentDocument).
await exec(sid,`window.__tr=null; window.addEventListener('message',e=>{var d=e.data; if(d&&d.__eigendeck===1&&d.type==='theme-report') window.__tr=d;});`);
const slides=await exec(sid,`return window.__eigendeck.store.getState().presentation.slides.map(s=>({theme:s.theme, bodyFont:s.bodyFont, hasDemo:s.elements.some(e=>e.type==='demo'||e.type==='demo-piece')}));`);
console.log('  deck has '+slides.length+' slides');

const fails=[]; let ok=0, checked=0;
for(let i=0;i<slides.length;i++){
  const sl=slides[i]; if(!sl.hasDemo) continue; checked++;
  const themeName=sl.theme||'white', exp=THEMES[themeName]||THEMES.white;
  const fid=sl.bodyFont||'ptsans', fam=FONT_FAMILY[fid]||'PT Sans';
  await exec(sid,`window.__eigendeck.store.getState().selectSlide(${i});`);
  await sleep(700); // let the outgoing demo unmount before we request
  // request a fresh report from the CURRENT (mounted) demo (prefer font loaded)
  let r=null; for(let k=0;k<16;k++){
    await exec(sid,`window.__tr=null; var f=document.querySelector('iframe.el-demo-frame'); if(f&&f.contentWindow) f.contentWindow.postMessage({__eigendeck:1,type:'request-theme-report'},'*');`);
    await sleep(300);
    const t=await exec(sid,`return window.__tr`); if(t){ r=t; if(t.fontLoaded) break; }
  }
  const tag=`[${i}] ${fid}/${themeName}`;
  if(!r){ fails.push(`${tag}: demo never reported`); continue; }
  let good=true;
  for(const [nm,got,hex] of [['bg',r.bg,exp.bg],['fg',r.fg,exp.fg],['heading',r.heading,exp.heading],['accent',r.accent,exp.accent],['muted',r.muted,exp.muted]]){
    if(got!==hexToRgb(hex)){ fails.push(`${tag}: ${nm} ${got} != ${hexToRgb(hex)}`); good=false; }
  }
  if(!r.fontVar.includes(fam)){ fails.push(`${tag}: --eigendeck-font "${r.fontVar}" !~ "${fam}"`); good=false; }
  if(!r.fontLoaded){ fails.push(`${tag}: font "${fam}" not loaded`); good=false; }
  if(good) ok++;
}
console.log(`  PASS ${ok}/${checked} demo slides`);
if(fails.length){ console.log('  FAILURES:'); for(const f of fails.slice(0,50)) console.log('   - '+f); }
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log(fails.length?'DECKVERIFY_RESULT: FAIL':'DECKVERIFY_RESULT: PASS');
process.exit(fails.length?1:0);
