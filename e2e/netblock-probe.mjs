// Verify the demo internet-block ENFORCEMENT (docs/CSP-AND-EGRESS.md). Flip the
// global demoInternetAccess pref OFF, mount the notebook's interactive output, and
// assert it comes up with RTCPeerConnection gone AND a fetch tripping a
// connect-src CSP violation — i.e. the injected lockdown + WebRTC neuter WORK.
const BASE='http://127.0.0.1:4444',APP=process.env.E2E_APP,DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(s,x){return (await post(`/session/${s}/execute/sync`,{script:x,args:[]}))?.value}
async function open(){for(let i=0;i<12;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});if(j?.value?.sessionId)return j.value.sessionId;await sleep(1000);}return null;}
async function waitSeam(s){for(let i=0;i<25;i++){await sleep(800);if(await exec(s,"return !!(window.__eigendeck&&window.__eigendeck.store.getState().projectPath)"))return true;}return false;}
const fail=m=>{console.error('NETBLOCK_FAIL:',m);process.exit(1);};

const sid=await open(); if(!sid) fail('no session'); if(!await waitSeam(sid)) fail('no seam');
// collect reports + flip the master switch OFF (before the notebook slide mounts)
await exec(sid,`window.__np=[]; window.addEventListener('message',e=>{var d=e.data; if(d&&d.__netprobe===1)window.__np.push(d);});`);
await exec(sid,`localStorage.setItem('eigendeck:pref:demoInternetAccess','false');`);
await sleep(300);
await exec(sid,`window.__eigendeck.store.getState().selectSlide(1);`);  // notebook on slide 1
let reports=[];
for(let k=0;k<15;k++){ await sleep(700); reports=await exec(sid,`return window.__np`)||[]; if(reports.some(r=>r.cspBlocked))break; }
console.log('  reports:', JSON.stringify(reports));
if(!reports.length) fail('interactive output never reported (did it mount?)');
if(!reports.some(x=>x.rtc==='gone')) fail('WebRTC NOT neutered: '+JSON.stringify(reports.map(r=>r.rtc)));
if(!reports.some(x=>x.cspBlocked===true)) fail('fetch did NOT trip a connect-src violation — the CSP lockdown is not enforced');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
console.log('NETBLOCK_PASS: internet blocked — RTCPeerConnection gone + connect-src CSP violation on fetch');
process.exit(0);
