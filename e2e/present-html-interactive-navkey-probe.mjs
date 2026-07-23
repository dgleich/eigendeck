// #155 CAVEAT characterization: an `html` element with `interactive` renders in
// present mode as a SCRIPT-LESS, fully-locked iframe (HTML_SANDBOX_LOCKED, no
// allow-scripts, by the no-JS security design). Unlike a demo, it therefore
// cannot run the injected nav-key forwarder — so a native control inside it (a
// focused radio/checkbox using arrows) still SWALLOWS Space/arrows and present
// nav is fiddly there. The demo fix (#155) does NOT cover this case.
//
// The behavioral half (focus a control inside the locked iframe, press an arrow,
// observe the swallow) CANNOT be driven headlessly — the parent can't reach into
// a locked cross-origin iframe to focus its controls or read its key events. So
// this probe pins the STRUCTURAL cause: the interactive html iframe is script-less
// and its srcdoc carries no nav-key forwarder. If html-element key forwarding is
// ever added (resolving the caveat), this probe fails → update it + close the gap.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(sid){for(let i=0;i<25;i++){await sleep(800);if(await exec(sid,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('HTMLNAV_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid||!await waitSeam(sid)) fail('open');
const nInt=await exec(sid,"return window.__eigendeck.store.getState().presentation.slides.flatMap(s=>s.elements).filter(e=>e.type==='html'&&e.interactive).length;");
if(nInt<1) fail('fixture has no interactive html element');
await exec(sid,"window.__eigendeck.store.getState().selectSlide(0);");
await exec(sid,"window.__eigendeck.store.getState().setPresenting(true);");
// wait for the present-mode html iframe to render
let info=null;
for(let i=0;i<20;i++){
  info=await exec(sid,`
    const f=document.querySelector('iframe[title="HTML element"]');
    if(!f) return null;
    return JSON.stringify({
      sandbox: f.getAttribute('sandbox'),
      pe: getComputedStyle(f).pointerEvents,
      hasForwarder: /nav-key|__NAVK/.test(f.getAttribute('srcdoc')||''),
      hasScriptTag: /<script/i.test(f.getAttribute('srcdoc')||''),
    });
  `);
  if(info) break; await sleep(300);
}
if(!info) fail('interactive html iframe never rendered in present mode');
const d=JSON.parse(info);
console.log('  present html iframe:', info);

// The CAUSE of the caveat: script-less + interactive + no forwarder.
if(/allow-scripts/.test(d.sandbox||'')) fail('interactive html iframe has allow-scripts — expected the locked, script-less sandbox');
if(d.pe!=='auto') fail('interactive html iframe pointer-events='+d.pe+' (expected auto — it IS interactive, so a control can take focus)');
if(d.hasForwarder) fail('CAVEAT RESOLVED? the html iframe now carries a nav-key forwarder — update this probe + close #155-html');
if(d.hasScriptTag) fail('interactive html srcdoc has a <script> — the no-JS guarantee (and thus this caveat analysis) changed; re-verify');

await exec(sid,"window.__eigendeck.store.getState().setPresenting(false);");
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('HTMLNAV_PASS: interactive html element is script-less + forwarder-less → nav keys are swallowed (known caveat, #155)');
process.exit(0);
