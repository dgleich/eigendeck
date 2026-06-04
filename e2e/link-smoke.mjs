// Drive the link-conflict chooser end-to-end. Two independent notebooks with
// DIFFERENT recordings (MARK_A on slide 1, MARK_B on slide 2). Open LinkOverlay
// on nb1, click nb2 → conflict chooser → keep source (MARK_A). Expect MARK_A
// survives and MARK_B is discarded.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await exec(sid,"return document.body?document.body.textContent:''")||'');}

let sid;
for(let i=0;i<12&&!sid;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});sid=j?.value?.sessionId;if(!sid)await sleep(1000);}
if(!sid){console.error('NO SESSION');process.exit(2);}

// Wait for the deck to load (MARK_A is the slide-1 recording).
let loaded=false;
for(let i=0;i<20;i++){await sleep(1000);if((await dom(sid)).includes('MARK_A')){loaded=true;break;}}
if(!loaded){console.error('FAIL: deck did not load (no MARK_A)');console.error((await dom(sid)).slice(0,400));process.exit(1);}

// Open LinkOverlay on nb1 (source), via the same event the "L" button fires.
await exec(sid,"window.dispatchEvent(new CustomEvent('open-link-overlay',{detail:{elementId:'nb1'}}));");
await sleep(800);
const overlayUp = await exec(sid,"return !!document.querySelector('.link-overlay')");
if(!overlayUp){console.error('FAIL: LinkOverlay did not open');process.exit(1);}

// Click the target element (nb2 on the shown slide).
const clickedTarget = await exec(sid,"const e=document.querySelector('.link-overlay-element'); if(e){e.click();return true;} return false;");
if(!clickedTarget){console.error('FAIL: no .link-overlay-element to click');process.exit(1);}
await sleep(1000);

// The conflict chooser must appear (two different recordings).
const chooserUp = await exec(sid,"return !!document.querySelector('.overlay-conflict-choices')");
if(!chooserUp){console.error('FAIL: conflict chooser did not appear');console.error((await dom(sid)).slice(0,400));process.exit(1);}

// Keep the SOURCE recording (first card = slide 1 = MARK_A).
await exec(sid,"const c=document.querySelectorAll('.overlay-conflict-card'); if(c[0]) c[0].click();");
await sleep(1200);

const final = await dom(sid);
const hasA = final.includes('MARK_A');
const hasB = final.includes('MARK_B');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(hasA && !hasB){ console.log('LINK_SMOKE_PASS: kept MARK_A, discarded MARK_B'); process.exit(0); }
console.error(`LINK_SMOKE_FAIL: MARK_A=${hasA} MARK_B=${hasB}`);
console.error(final.slice(0,500));
process.exit(1);
