// Verify the "L" (Time-Machine) button establishes an ANIMATION LINK and is
// NON-DESTRUCTIVE: clicking a target must NOT raise a sync/merge chooser and
// must NOT discard either side's recording. Deck: two independent notebooks,
// MARK_A on slide 1, MARK_B on slide 2.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await exec(sid,"return document.body?document.body.textContent:''")||'');}

let sid;
for(let i=0;i<12&&!sid;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});sid=j?.value?.sessionId;if(!sid)await sleep(1000);}
if(!sid){console.error('NO SESSION');process.exit(2);}

let loaded=false;
for(let i=0;i<20;i++){await sleep(1000);if((await dom(sid)).includes('MARK_A')){loaded=true;break;}}
if(!loaded){console.error('FAIL: deck did not load (no MARK_A)');process.exit(1);}

// Open LinkOverlay on nb1 (source), then click the target notebook (nb2).
await exec(sid,"window.dispatchEvent(new CustomEvent('open-link-overlay',{detail:{elementId:'nb1'}}));");
await sleep(800);
if(!await exec(sid,"return !!document.querySelector('.link-overlay')")){console.error('FAIL: LinkOverlay did not open');process.exit(1);}
if(!await exec(sid,"const e=document.querySelector('.link-overlay-element'); if(e){e.click();return true;} return false;")){console.error('FAIL: no .link-overlay-element');process.exit(1);}
await sleep(1000);

// A sync/merge chooser must NEVER appear (link is non-destructive)...
const chooser = await exec(sid,"return !!document.querySelector('.overlay-conflict-choices')");
// ...the overlay should have closed (link established)...
const overlayGone = !(await exec(sid,"return !!document.querySelector('.link-overlay')"));
// ...and slide 1's recording is untouched (nothing merged/discarded).
const stillA = (await dom(sid)).includes('MARK_A');

await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
const ok = !chooser && overlayGone && stillA;
console.log(ok ? 'LINK_SMOKE_PASS: animation link, no chooser, recording preserved'
              : `LINK_SMOKE_FAIL: chooser=${chooser} overlayGone=${overlayGone} stillA=${stillA}`);
process.exit(ok?0:1);
