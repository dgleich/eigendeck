// Verify manifest-SCOPED egress (docs/CSP-AND-EGRESS.md §2b). Internet stays ON.
// The notebook output declares a manifest for allowed.example, then fetches both
// allowed.example (declared) and blocked.example (undeclared). Assert the injected
// scoped connect-src lets the declared host through (no CSP violation for it) while
// the undeclared host trips a connect-src violation — i.e. declared != granted, and
// a demo can only reach the hosts it declared.
const BASE='http://127.0.0.1:4444',APP=process.env.E2E_APP,DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('NETMANIFEST_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
// Internet stays ON — we test the manifest scoping, not the block. Collect reports.
await exec(sid,`window.__np=[]; window.addEventListener('message',e=>{var d=e.data; if(d&&d.__netprobe===1)window.__np.push(d);});`);
await sleep(200);
await exec(sid,`window.__eigendeck.store.getState().selectSlide(1);`);  // notebook on slide 1
let reports=[];
for(let k=0;k<15;k++){ await sleep(700); reports=await exec(sid,`return window.__np`)||[]; if(reports.some(r=>(r.viol||[]).some(u=>u.indexOf('blocked.example')>=0)))break; }
console.log('  reports:', JSON.stringify(reports));
if(!reports.length) fail('interactive output never reported (did it mount?)');
const allViol=reports.flatMap(r=>r.viol||[]);
if(!allViol.some(u=>u.indexOf('blocked.example')>=0)) fail('undeclared host did NOT trip a connect-src violation — scoping is not enforced: '+JSON.stringify(allViol));
if(allViol.some(u=>u.indexOf('allowed.example')>=0)) fail('DECLARED host was blocked — the manifest allowlist was not applied: '+JSON.stringify(allViol));
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('NETMANIFEST_PASS: declared host allowed, undeclared host blocked by scoped connect-src');
process.exit(0);
