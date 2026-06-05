// Promote (link→sync) with CONFLICTING notebook recordings must raise the
// chooser; picking a copy keeps ITS recording. Deck: nb1=MARK_A (slide1),
// nb2=MARK_B (slide2). Link them, fire promote on nb1 → chooser (2 cards) →
// pick slide-2's card → assert MARK_B survives, MARK_A discarded, one entry.
const BASE='http://127.0.0.1:4444', APP=process.env.E2E_APP, DECK=process.env.E2E_DECK;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function post(p,b){const r=await fetch(BASE+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const t=await r.text();try{return JSON.parse(t)}catch{return t}}
async function exec(sid,s){return (await post(`/session/${sid}/execute/sync`,{script:s,args:[]}))?.value}
async function execAsync(sid,s){return (await post(`/session/${sid}/execute/async`,{script:s,args:[]}))?.value}
async function dom(sid){return String(await exec(sid,"return document.body?document.body.textContent:''")||'');}
const fail=(m)=>{console.error('CHOOSER_FAIL:',m);process.exit(1);};

let sid; for(let i=0;i<12&&!sid;i++){const j=await post('/session',{capabilities:{alwaysMatch:{'tauri:options':{application:APP,args:[DECK]}}}});sid=j?.value?.sessionId;if(!sid)await sleep(1000);}
if(!sid) fail('no session');
for(let i=0;i<20;i++){await sleep(800);if((await dom(sid)).includes('MARK_A'))break;}

// Link nb1↔nb2, then fire the promote event on nb1.
await exec(sid,"const s=window.__eigendeck.store; s.getState().selectSlide(0); s.getState().linkElements('nb1',1,'nb2');");
await sleep(300);
await exec(sid,"window.dispatchEvent(new CustomEvent('promote-to-sync',{detail:{elementId:'nb1'}}));");

// The chooser must appear with 2 cards (two different recordings).
let cards=0; for(let i=0;i<15;i++){await sleep(400); cards=await exec(sid,"return document.querySelectorAll('.overlay-conflict-card').length"); if(cards>=2)break;}
if(cards<2) fail(`chooser did not show 2 cards (got ${cards})`);
console.log('  chooser appeared with', cards, 'cards');

// Pick the SECOND card (slide 2 = MARK_B).
await exec(sid,"const c=document.querySelectorAll('.overlay-conflict-card'); c[1] && c[1].click();");
await sleep(1500);

// Structure: one synced entry. Recording: MARK_B kept, MARK_A gone.
const j = JSON.parse(await execAsync(sid,"const d=arguments[arguments.length-1];window.__TAURI_INTERNALS__.invoke('db_export_json').then(d).catch(e=>d('ERR:'+e));"));
const a=j.slides?.[0]?.elements?.[0], b=j.slides?.[1]?.elements?.[0];
const oneEntry = a && b && a.id===b.id && !!a.syncId;
const txt = await dom(sid);
const keptB = txt.includes('MARK_B'), droppedA = !txt.includes('MARK_A');
await fetch(`${BASE}/session/${sid}`,{method:'DELETE'}).catch(()=>{});
if(oneEntry && keptB && droppedA){ console.log('CHOOSER_PASS: chooser shown; picked slide 2 → MARK_B kept, MARK_A discarded, one synced entry'); process.exit(0); }
fail(`oneEntry=${oneEntry} keptB=${keptB} droppedA=${droppedA}`);
