// Present-vs-design parity: slide theme background must apply in PRESENT mode.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('PM_FAIL:',m);process.exit(1);};
const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');

// set deck theme to dark (#1a1a2e = rgb(26,26,46)) and enter present mode
await exec(sid,"window.__eigendeck.store.getState().setTheme('dark');");
await sleep(300);
// design-mode canvas bg (sanity)
const designBg=await exec(sid,"const c=document.querySelector('.slide-canvas')||document.querySelector('[class*=canvas]'); return c?getComputedStyle(c).backgroundColor:'NO_CANVAS';");
await exec(sid,"window.__eigendeck.store.getState().setPresenting(true);");
for(let i=0;i<15;i++){ await sleep(400); if(await exec(sid,"return !!document.querySelector('.present-slide')")) break; }
const presentBg=await exec(sid,"const s=document.querySelector('.present-slide'); return s?getComputedStyle(s).backgroundColor:'NO_PRESENT_SLIDE';");
await exec(sid,"window.__eigendeck.store.getState().setPresenting(false);");
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('  design canvas bg:', designBg);
console.log('  present-slide bg:', presentBg);
// dark theme bg = rgb(26, 26, 46); must NOT be white
if(presentBg==='NO_PRESENT_SLIDE') fail('present mode did not render .present-slide');
if(/rgb\(255,\s*255,\s*255\)/.test(presentBg) || presentBg==='rgba(0, 0, 0, 0)') { console.error('PM_BUG: present-slide background did not pick up the theme (got '+presentBg+', want rgb(26,26,46))'); process.exit(2); }
if(!/rgb\(26,\s*26,\s*46\)/.test(presentBg)) { console.error('PM_WARN: unexpected bg '+presentBg); process.exit(2); }
console.log('PM_PASS: theme background applies in present mode');
process.exit(0);
